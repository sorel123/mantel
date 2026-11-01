/**
 * Settings › Layout › Your own: the Custom Today layout as a grid of cards. Drag a card to
 * move it, drag its corner to resize it, tap to select it (then Remove, or arrow keys to move
 * and Shift+arrows to resize). Cards snap to half cells and stop at their smallest readable size
 * (CARD_MIN). Moves that would overlap another card or leave the grid snap back. Changes go to the settings draft like every other field; Save keeps them.
 */
import {
  CARD_MIN,
  CARD_STARTS,
  TODAY_CARD_STEP,
  TODAY_CARDS,
  TODAY_GRID_COLS,
  TODAY_GRID_ROWS,
  cardFits,
  cardSize,
  findSpot,
  type TodayCard,
  type TodayCardKind,
} from '@mantel/shared';
import { useRef, useState, type CSSProperties, type PointerEvent } from 'react';

/** The size a new card asks for first, then smaller ones until one fits. */
const START_SIZE: Record<TodayCardKind, [number, number]> = {
  date: [4, 2],
  weather: [4, 4],
  forecast: [6, 2],
  agenda: [4, 6],
  week: [8, 5],
  photo: [4, 4],
  list: [3, 3],
  countdowns: [4, 1],
  tonight: [4, 1],
};

const nameOf = (k: TodayCardKind) => TODAY_CARDS.find((c) => c.id === k)?.name ?? k;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const STEP = TODAY_CARD_STEP;

type Drag = {
  id: string;
  mode: 'move' | 'resize';
  x0: number;
  y0: number;
  orig: TodayCard;
  moved: boolean;
};

export function CardEditor({
  value,
  onChange,
}: {
  value: TodayCard[];
  onChange: (cards: TodayCard[]) => void;
}) {
  const canvas = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [ghost, setGhost] = useState<TodayCard | null>(null);
  const [note, setNote] = useState('');

  const cell = () => {
    const r = canvas.current?.getBoundingClientRect();
    return r ? { w: r.width / TODAY_GRID_COLS, h: r.height / TODAY_GRID_ROWS } : { w: 1, h: 1 };
  };

  /** Where a drag puts the card, clamped to the grid (it may still overlap another). */
  const moveTo = (d: Drag, dx: number, dy: number): TodayCard => {
    const o = d.orig;
    return d.mode === 'move'
      ? {
          ...o,
          x: clamp(o.x + dx, 0, TODAY_GRID_COLS - o.w),
          y: clamp(o.y + dy, 0, TODAY_GRID_ROWS - o.h),
        }
      : {
          ...o,
          w: clamp(o.w + dx, Math.min(CARD_MIN[o.kind][0], o.w), TODAY_GRID_COLS - o.x),
          h: clamp(o.h + dy, Math.min(CARD_MIN[o.kind][1], o.h), TODAY_GRID_ROWS - o.y),
        };
  };

  const replace = (card: TodayCard) => onChange(value.map((c) => (c.id === card.id ? card : c)));

  /** Commit a card's new place, or say why not. */
  const place = (card: TodayCard) => {
    if (cardFits(card, value)) replace(card);
    else setNote('That would cover another card. Move or shrink that one first.');
  };

  const down = (e: PointerEvent, card: TodayCard, mode: Drag['mode']) => {
    e.stopPropagation();
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setSelected(card.id);
    setNote('');
    setDrag({ id: card.id, mode, x0: e.clientX, y0: e.clientY, orig: card, moved: false });
  };
  const move = (e: PointerEvent) => {
    if (!drag) return;
    const c = cell();
    const dx = Math.round((e.clientX - drag.x0) / c.w / STEP) * STEP;
    const dy = Math.round((e.clientY - drag.y0) / c.h / STEP) * STEP;
    if (!drag.moved && dx === 0 && dy === 0) return;
    if (!drag.moved) setDrag({ ...drag, moved: true });
    const next = moveTo(drag, dx, dy);
    const o = drag.orig;
    if (drag.mode === 'resize' && (o.w + dx < next.w || o.h + dy < next.h)) {
      const [mw, mh] = CARD_MIN[o.kind];
      setNote(`${nameOf(o.kind)} can't get smaller than ${cardSize(mw)} by ${cardSize(mh)}.`);
    }
    setGhost(next);
  };
  const up = () => {
    if (drag?.moved && ghost) place(ghost);
    setDrag(null);
    setGhost(null);
  };

  const key = (e: React.KeyboardEvent, card: TodayCard) => {
    const dir: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const d = dir[e.key];
    if (d) {
      e.preventDefault();
      setNote('');
      const fake: Drag = {
        id: card.id,
        mode: e.shiftKey ? 'resize' : 'move',
        x0: 0,
        y0: 0,
        orig: card,
        moved: true,
      };
      const next = moveTo(fake, d[0] * STEP, d[1] * STEP);
      const [mw, mh] = CARD_MIN[card.kind];
      if (e.shiftKey && next.w === card.w && next.h === card.h && (d[0] < 0 || d[1] < 0))
        setNote(`${nameOf(card.kind)} can't get smaller than ${cardSize(mw)} by ${cardSize(mh)}.`);
      else place(next);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      remove(card.id);
    }
  };

  const remove = (id: string) => {
    onChange(value.filter((c) => c.id !== id));
    setSelected(null);
    setNote('');
  };

  const add = (kind: TodayCardKind) => {
    const [w0, h0] = START_SIZE[kind];
    const [mw, mh] = CARD_MIN[kind];
    for (let h = h0; h >= mh; h -= STEP)
      for (let w = w0; w >= mw; w -= STEP) {
        const spot = findSpot(value, w, h);
        if (!spot) continue;
        let id: string = kind;
        for (let n = 2; value.some((c) => c.id === id); n++) id = `${kind}-${n}`;
        onChange([...value, { id, kind, ...spot, w, h }]);
        setSelected(id);
        setNote('');
        return;
      }
    setNote('No room left. Make a card smaller or remove one first.');
  };

  const box = (c: TodayCard): CSSProperties => ({
    left: `${(c.x / TODAY_GRID_COLS) * 100}%`,
    top: `${(c.y / TODAY_GRID_ROWS) * 100}%`,
    width: `${(c.w / TODAY_GRID_COLS) * 100}%`,
    height: `${(c.h / TODAY_GRID_ROWS) * 100}%`,
  });

  const sel = value.find((c) => c.id === selected);
  return (
    <div className="set-sub ced">
      <div className="set-label">
        Your layout
        <span className="set-hint">
          Drag a card to move it and its corner to resize it, in half steps. Each card stops at the
          smallest size it stays readable at, and its contents shrink a little to fit a small card.
          Tap one to select it; arrow keys move it and Shift with an arrow resizes it.
        </span>
      </div>
      <div
        className="ced-canvas"
        ref={canvas}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerDown={() => setSelected(null)}
        role="group"
        aria-label="Today layout"
        style={{ '--cols': TODAY_GRID_COLS, '--rows': TODAY_GRID_ROWS } as CSSProperties}
      >
        {value.map((c) => {
          const dragging = drag?.id === c.id && drag.moved;
          return (
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              className={`ced-card${c.id === selected ? ' sel' : ''}${dragging ? ' lifting' : ''}`}
              data-kind={c.kind}
              style={box(c)}
              aria-label={`${nameOf(c.kind)}, ${c.w} by ${c.h}`}
              title={`Smallest: ${cardSize(CARD_MIN[c.kind][0])} × ${cardSize(CARD_MIN[c.kind][1])}`}
              aria-pressed={c.id === selected}
              onPointerDown={(e) => down(e, c, 'move')}
              onKeyDown={(e) => key(e, c)}
              onFocus={() => setSelected(c.id)}
            >
              <b>{nameOf(c.kind)}</b>
              <span className="tnum">
                {cardSize(c.w)} × {cardSize(c.h)}
              </span>
              <span
                className="ced-grip"
                aria-hidden="true"
                onPointerDown={(e) => down(e, c, 'resize')}
              />
            </div>
          );
        })}
        {ghost && (
          <div
            className={`ced-ghost${cardFits(ghost, value) ? '' : ' bad'}`}
            style={box(ghost)}
            aria-hidden="true"
          />
        )}
      </div>
      <p className="set-hint ced-note" role="status">
        {note ||
          (sel
            ? `${nameOf(sel.kind)} selected.`
            : 'Small cards change shape: a short date is one line, a short weather card a single line.')}
      </p>
      <div className="ced-tools">
        {sel && (
          <button type="button" className="set-btn" onClick={() => remove(sel.id)}>
            Remove {nameOf(sel.kind)}
          </button>
        )}
        <div className="lay-addrow" role="group" aria-label="Add a card">
          {TODAY_CARDS.map((k) => (
            <button
              key={k.id}
              type="button"
              className="set-btn"
              title={k.description}
              onClick={() => add(k.id)}
            >
              + {k.name}
            </button>
          ))}
        </div>
        <div className="ced-starts" role="group" aria-label="Start over from">
          <span className="set-hint">Start over from:</span>
          {(
            [
              ['agenda', 'Agenda'],
              ['weather', 'Weather focus'],
              ['photo', 'Photo and agenda'],
            ] as const
          ).map(([id, name]) => (
            <button
              key={id}
              type="button"
              className="set-btn quiet"
              onClick={() => {
                onChange(CARD_STARTS[id].map((c) => ({ ...c })));
                setSelected(null);
                setNote('');
              }}
            >
              {name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
