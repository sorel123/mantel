/**
 * Settings › Layout › Your own: the Custom Today layout as a grid of cards. Drag a card to
 * move it, drag any edge or corner to resize it, tap to select it (then Remove, or arrow keys to
 * move and Shift+arrows to resize). Cards snap to half cells and stop at their smallest readable
 * size (CARD_MIN). Moves that would overlap another card or leave the grid snap back.
 *
 * Below the grid: start from one of the starter layouts or from one the household saved, save
 * this one by name, and preview the real Today screen with it. Everything goes to the settings
 * draft like every other field; Save keeps it.
 */
import {
  CARD_MIN,
  CARD_STARTERS,
  TODAY_CARD_STEP,
  TODAY_CARDS,
  TODAY_GRID_COLS,
  TODAY_GRID_ROWS,
  cardFits,
  cardSize,
  findSpot,
  type LayoutSettings,
  type SavedTodayLayout,
  type TodayCard,
  type TodayCardKind,
} from '@mantel/shared';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type PointerEvent,
} from 'react';
import { openPreview, previewUrl } from '../../../lib/preview';

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

/** Which edges a drag moves: all four to move the card, one or two to resize it. */
type Edges = { l?: boolean; r?: boolean; t?: boolean; b?: boolean };
const HANDLES: ReadonlyArray<[string, Edges, string]> = [
  ['n', { t: true }, 'top'],
  ['s', { b: true }, 'bottom'],
  ['w', { l: true }, 'left'],
  ['e', { r: true }, 'right'],
  ['nw', { t: true, l: true }, 'top left'],
  ['ne', { t: true, r: true }, 'top right'],
  ['sw', { b: true, l: true }, 'bottom left'],
  ['se', { b: true, r: true }, 'bottom right'],
];

type Drag = {
  id: string;
  edges: Edges | 'move';
  x0: number;
  y0: number;
  orig: TodayCard;
  moved: boolean;
};

/** Where a drag of dx, dy cells puts the card, and whether it ran into the smallest size. */
function dragTo(o: TodayCard, edges: Edges | 'move', dx: number, dy: number) {
  if (edges === 'move')
    return {
      card: {
        ...o,
        x: clamp(o.x + dx, 0, TODAY_GRID_COLS - o.w),
        y: clamp(o.y + dy, 0, TODAY_GRID_ROWS - o.h),
      },
      atMin: false,
    };
  const mw = Math.min(CARD_MIN[o.kind][0], o.w);
  const mh = Math.min(CARD_MIN[o.kind][1], o.h);
  let { x, y, w, h } = o;
  let atMin = false;
  if (edges.r) {
    atMin ||= o.w + dx < mw;
    w = clamp(o.w + dx, mw, TODAY_GRID_COLS - o.x);
  }
  if (edges.l) {
    atMin ||= o.w - dx < mw;
    x = clamp(o.x + dx, 0, o.x + o.w - mw);
    w = o.w + o.x - x;
  }
  if (edges.b) {
    atMin ||= o.h + dy < mh;
    h = clamp(o.h + dy, mh, TODAY_GRID_ROWS - o.y);
  }
  if (edges.t) {
    atMin ||= o.h - dy < mh;
    y = clamp(o.y + dy, 0, o.y + o.h - mh);
    h = o.h + o.y - y;
  }
  return { card: { ...o, x, y, w, h }, atMin };
}

const minNote = (k: TodayCardKind) =>
  `${nameOf(k)} can't get smaller than ${cardSize(CARD_MIN[k][0])} by ${cardSize(CARD_MIN[k][1])}.`;

const sameCards = (a: readonly TodayCard[], b: readonly TodayCard[]) =>
  a.length === b.length &&
  a.every((c, i) => {
    const d = b[i]!;
    return c.kind === d.kind && c.x === d.x && c.y === d.y && c.w === d.w && c.h === d.h;
  });

export function CardEditor({
  layout,
  onChange,
}: {
  layout: LayoutSettings;
  onChange: (layout: LayoutSettings) => void;
}) {
  const value = layout.todayCards;
  const saved = layout.savedToday ?? [];
  const setCards = (todayCards: TodayCard[]) => onChange({ ...layout, todayCards });
  const canvas = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [ghost, setGhost] = useState<TodayCard | null>(null);
  const [note, setNote] = useState('');
  const [showPreview, setShowPreview] = useState(false);

  const cell = () => {
    const r = canvas.current?.getBoundingClientRect();
    return r ? { w: r.width / TODAY_GRID_COLS, h: r.height / TODAY_GRID_ROWS } : { w: 1, h: 1 };
  };

  const replace = (card: TodayCard) => setCards(value.map((c) => (c.id === card.id ? card : c)));

  /** Commit a card's new place, or say why not. */
  const place = (card: TodayCard) => {
    if (cardFits(card, value)) replace(card);
    else setNote('That would cover another card. Move or shrink that one first.');
  };

  const down = (e: PointerEvent, card: TodayCard, edges: Drag['edges']) => {
    e.stopPropagation();
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setSelected(card.id);
    setNote('');
    setDrag({ id: card.id, edges, x0: e.clientX, y0: e.clientY, orig: card, moved: false });
  };
  const move = (e: PointerEvent) => {
    if (!drag) return;
    const c = cell();
    const dx = Math.round((e.clientX - drag.x0) / c.w / STEP) * STEP;
    const dy = Math.round((e.clientY - drag.y0) / c.h / STEP) * STEP;
    if (!drag.moved && dx === 0 && dy === 0) return;
    if (!drag.moved) setDrag({ ...drag, moved: true });
    const next = dragTo(drag.orig, drag.edges, dx, dy);
    if (next.atMin) setNote(minNote(drag.orig.kind));
    setGhost(next.card);
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
      const next = dragTo(
        card,
        e.shiftKey ? { r: true, b: true } : 'move',
        d[0] * STEP,
        d[1] * STEP,
      );
      if (next.atMin) setNote(minNote(card.kind));
      else place(next.card);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      remove(card.id);
    }
  };

  const remove = (id: string) => {
    setCards(value.filter((c) => c.id !== id));
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
        setCards([...value, { id, kind, ...spot, w, h }]);
        setSelected(id);
        setNote('');
        return;
      }
    setNote('No room left. Make a card smaller or remove one first.');
  };

  const load = (cards: readonly TodayCard[], name: string) => {
    setCards(cards.map((c) => ({ ...c })));
    setSelected(null);
    setNote(`Started from ${name}.`);
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
          Drag a card to move it, and drag any edge or corner to resize it, in half steps. Each card
          stops at the smallest size it stays readable at, and its contents shrink a little to fit a
          small card. Tap one to select it; arrow keys move it and Shift with an arrow resizes it.
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
              title={`Smallest: ${cardSize(CARD_MIN[c.kind][0])} × ${cardSize(CARD_MIN[c.kind][1])}`}
              onPointerDown={(e) => down(e, c, 'move')}
              onKeyDown={(e) => key(e, c)}
              onFocus={() => setSelected(c.id)}
            >
              <b>{nameOf(c.kind)}</b>
              <span className="tnum">
                {cardSize(c.w)} × {cardSize(c.h)}
              </span>
              {HANDLES.map(([id, edges, where]) => (
                <span
                  key={id}
                  className={`ced-h ced-h-${id}`}
                  data-edge={id}
                  title={`Drag to resize from the ${where}`}
                  aria-hidden="true"
                  onPointerDown={(e) => down(e, c, edges)}
                />
              ))}
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
        <div className="ced-row">
          {sel && (
            <button type="button" className="set-btn" onClick={() => remove(sel.id)}>
              Remove {nameOf(sel.kind)}
            </button>
          )}
          <button
            type="button"
            className="set-btn primary"
            aria-pressed={showPreview}
            onClick={() => setShowPreview((v) => !v)}
          >
            {showPreview ? 'Hide preview' : 'Preview'}
          </button>
          <button
            type="button"
            className="set-btn"
            onClick={() => openPreview({ layout, screen: 'today' })}
          >
            Preview on the wall
          </button>
        </div>
        {showPreview && <TodayPreview layout={layout} />}
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
        <SaveAs
          saved={saved}
          cards={value}
          onSave={(list, name) => {
            onChange({ ...layout, savedToday: list });
            setNote(`Saved as “${name}”. Press Save below to keep it.`);
          }}
        />
        {saved.length > 0 && (
          <Starters
            label="Your layouts"
            items={saved}
            current={value}
            onPick={(l) => load(l.cards, l.name)}
            onDelete={(l) => {
              onChange({ ...layout, savedToday: saved.filter((s) => s.id !== l.id) });
              setNote(`Deleted “${l.name}”.`);
            }}
          />
        )}
        <Starters
          label="Start from"
          items={CARD_STARTERS}
          current={value}
          onPick={(l) => load(l.cards, l.name)}
        />
      </div>
    </div>
  );
}

/** Save the current cards by name; a name already saved is updated. */
function SaveAs({
  saved,
  cards,
  onSave,
}: {
  saved: readonly SavedTodayLayout[];
  cards: readonly TodayCard[];
  onSave: (list: SavedTodayLayout[], name: string) => void;
}) {
  const [name, setName] = useState('');
  const trimmed = name.trim();
  const existing = saved.find((s) => s.name.toLowerCase() === trimmed.toLowerCase());
  const full = !existing && saved.length >= 20;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!trimmed || full) return;
    const entry = {
      id: existing?.id ?? `l${Date.now().toString(36)}`,
      name: trimmed,
      cards: [...cards],
    };
    onSave(
      existing ? saved.map((s) => (s.id === existing.id ? entry : s)) : [...saved, entry],
      trimmed,
    );
    setName('');
  };
  return (
    <form className="ced-row ced-save" onSubmit={submit}>
      <input
        className="set-input"
        aria-label="Layout name"
        placeholder="Name this layout"
        maxLength={40}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <button type="submit" className="set-btn" disabled={!trimmed || full}>
        {existing ? `Update “${existing.name}”` : 'Save as my layout'}
      </button>
      {full && <span className="set-hint">Twenty saved already; delete one first.</span>}
    </form>
  );
}

/** A row of layouts to start from, each drawn as a small picture of its cards. */
function Starters<T extends { id: string; name: string; cards: readonly TodayCard[] }>({
  label,
  items,
  current,
  onPick,
  onDelete,
}: {
  label: string;
  items: readonly T[];
  current: readonly TodayCard[];
  onPick: (item: T) => void;
  onDelete?: (item: T) => void;
}) {
  return (
    <div className="ced-starts" role="group" aria-label={label}>
      <span className="set-label">{label}</span>
      <div className="ced-start-list">
        {items.map((l) => (
          <div key={l.id} className="ced-start">
            <button
              type="button"
              className={`ced-start-btn${sameCards(l.cards, current) ? ' on' : ''}`}
              onClick={() => onPick(l)}
              aria-label={`${label === 'Start from' ? 'Start from' : 'Use'} ${l.name}`}
            >
              <CardsThumb cards={l.cards} />
              <span>{l.name}</span>
            </button>
            {onDelete && (
              <button
                type="button"
                className="ced-start-del"
                aria-label={`Delete ${l.name}`}
                onClick={() => onDelete(l)}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A small picture of a layout's cards. */
export function CardsThumb({ cards }: { cards: readonly TodayCard[] }) {
  return (
    <span className="ced-thumb" aria-hidden="true">
      {cards.map((c) => (
        <i
          key={c.id}
          data-kind={c.kind}
          style={{
            left: `${(c.x / TODAY_GRID_COLS) * 100}%`,
            top: `${(c.y / TODAY_GRID_ROWS) * 100}%`,
            width: `${(c.w / TODAY_GRID_COLS) * 100}%`,
            height: `${(c.h / TODAY_GRID_ROWS) * 100}%`,
          }}
        />
      ))}
    </span>
  );
}

/** The real Today screen with this layout, scaled down into the settings page. */
const PANEL_W = 1180;
const PANEL_H = 820;
function TodayPreview({ layout }: { layout: LayoutSettings }) {
  const box = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(0.5);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setK(el.clientWidth / PANEL_W));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const src = previewUrl({ layout: { ...layout, fit: 'fit', scale: 1 }, screen: 'today' });
  return (
    <div className="ced-preview" ref={box} style={{ height: PANEL_H * k }}>
      <iframe
        key={src}
        title="Preview of Today"
        src={src}
        width={PANEL_W}
        height={PANEL_H}
        style={{ transform: `scale(${k})` }}
        tabIndex={-1}
      />
    </div>
  );
}
