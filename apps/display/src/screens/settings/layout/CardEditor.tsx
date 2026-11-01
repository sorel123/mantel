/**
 * Settings › Layout › Your own: the Custom Today layout as a grid of cards. Drag a card to
 * move it, drag its corner to resize it, tap to select it (then Remove, or arrow keys to move
 * and Shift+arrows to resize). Moves that would overlap another card or leave the grid snap
 * back. Changes go to the settings draft like every other field; Save keeps them.
 */
import {
  CARD_STARTS,
  TODAY_CARDS,
  TODAY_GRID_COLS,
  TODAY_GRID_ROWS,
  cardFits,
  findSpot,
  type TodayCard,
  type TodayCardKind,
} from '@mantel/shared';
import { useRef, useState, type CSSProperties, type PointerEvent } from 'react';

/** The size a new card asks for first, then smaller ones until one fits. */
const START_SIZE: Record<TodayCardKind, [number, number]> = {
  date: [4, 2],
  weather: [4, 3],
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
          w: clamp(o.w + dx, 1, TODAY_GRID_COLS - o.x),
          h: clamp(o.h + dy, 1, TODAY_GRID_ROWS - o.y),
        };
  };

  const replace = (card: TodayCard) => onChange(value.map((c) => (c.id === card.id ? card : c)));

  /** Commit a card's new place, or say why not. */
  const place = (card: TodayCard) => {
    if (cardFits(card, value)) {
      replace(card);
      setNote('');
    } else setNote('That would cover another card. Move or shrink that one first.');
  };

  const down = (e: PointerEvent, card: TodayCard, mode: Drag['mode']) => {
    e.stopPropagation();
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setSelected(card.id);
    setDrag({ id: card.id, mode, x0: e.clientX, y0: e.clientY, orig: card, moved: false });
  };
  const move = (e: PointerEvent) => {
    if (!drag) return;
    const c = cell();
    const dx = Math.round((e.clientX - drag.x0) / c.w);
    const dy = Math.round((e.clientY - drag.y0) / c.h);
    if (!drag.moved && dx === 0 && dy === 0) return;
    if (!drag.moved) setDrag({ ...drag, moved: true });
    setGhost(moveTo(drag, dx, dy));
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
      const fake: Drag = {
        id: card.id,
        mode: e.shiftKey ? 'resize' : 'move',
        x0: 0,
        y0: 0,
        orig: card,
        moved: true,
      };
      place(moveTo(fake, d[0], d[1]));
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
    for (let h = h0; h >= 1; h--)
      for (let w = w0; w >= 1; w--) {
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
          Drag a card to move it and its corner to resize it. Tap one to select it; arrow keys move
          it and Shift with an arrow resizes it.
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
              aria-pressed={c.id === selected}
              onPointerDown={(e) => down(e, c, 'move')}
              onKeyDown={(e) => key(e, c)}
              onFocus={() => setSelected(c.id)}
            >
              <b>{nameOf(c.kind)}</b>
              <span className="tnum">
                {c.w} × {c.h}
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
