/**
 * Leave a note for the family: a few words on a coloured sticky, or a drawing with a finger.
 * Notes come down tonight, after a day, or when someone takes them down.
 */
import {
  NOTE_COLORS,
  type NoteColor,
  type NoteCreateRequest,
  type NoteExpiry,
} from '@mantel/shared';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent,
} from 'react';
import { useBootstrap } from '../../lib/bootstrap';
import { Avatar } from '../lists/Avatar';
import { NOTE_COLOR_NAMES, noteStyle } from './notes';

const EXPIRIES: Array<{ id: NoteExpiry; label: string }> = [
  { id: 'tonight', label: 'Tonight' },
  { id: '24h', label: 'A day' },
  { id: 'dismiss', label: 'Until taken down' },
];

export function NoteComposer({
  onPost,
  onCancel,
  startWith = 'text',
  wall = false,
}: {
  onPost: (note: NoteCreateRequest) => Promise<unknown>;
  onCancel?: () => void;
  startWith?: 'text' | 'drawing';
  /** On the wall the fields are bigger and the draw pad is the default. */
  wall?: boolean;
}) {
  const boot = useBootstrap();
  const [kind, setKind] = useState<'text' | 'drawing'>(startWith);
  const [text, setText] = useState('');
  const [color, setColor] = useState<NoteColor>('sun');
  const [expiry, setExpiry] = useState<NoteExpiry>('24h');
  const [personId, setPersonId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pad = useRef<DrawPadHandle>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const image = kind === 'drawing' ? pad.current?.toPng() : undefined;
    if (kind === 'drawing' && !image) {
      setError('Draw something first.');
      return;
    }
    if (kind === 'text' && !text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onPost({
        kind,
        text: text.trim(),
        color,
        expiry,
        ...(personId ? { personId } : {}),
        ...(image ? { image } : {}),
      });
      setText('');
      pad.current?.clear();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={`nc${wall ? ' wall' : ''}`} onSubmit={(e) => void submit(e)}>
      <div className="achips" role="radiogroup" aria-label="Kind of note">
        {(['text', 'drawing'] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            className="achip"
            onClick={() => setKind(k)}
          >
            {k === 'text' ? 'Words' : 'Drawing'}
          </button>
        ))}
      </div>

      <div className="nc-paper" style={noteStyle(color)}>
        {kind === 'text' ? (
          <textarea
            className="nc-text"
            value={text}
            maxLength={280}
            rows={wall ? 4 : 3}
            placeholder="Back at 6. Dinner's in the fridge."
            aria-label="Note"
            onChange={(e) => setText(e.target.value)}
            autoFocus={!wall}
          />
        ) : (
          <DrawPad ref={pad} height={wall ? 300 : 220} />
        )}
      </div>

      <div className="nc-colors" role="radiogroup" aria-label="Colour">
        {NOTE_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={color === c}
            aria-label={NOTE_COLOR_NAMES[c]}
            className="nc-swatch"
            style={noteStyle(c)}
            onClick={() => setColor(c)}
          />
        ))}
      </div>

      <div className="achips" role="radiogroup" aria-label="Stays until">
        {EXPIRIES.map((x) => (
          <button
            key={x.id}
            type="button"
            role="radio"
            aria-checked={expiry === x.id}
            className="achip"
            onClick={() => setExpiry(x.id)}
          >
            {x.label}
          </button>
        ))}
      </div>

      {boot.people.length > 0 && (
        <div className="achips" role="radiogroup" aria-label="From">
          {boot.people.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={personId === p.id}
              className="achip"
              onClick={() => setPersonId(personId === p.id ? undefined : p.id)}
            >
              <Avatar person={p} size="sm" />
              {p.name}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className="qa-err" role="alert">
          {error}
        </p>
      )}
      <div className="nc-actions">
        {onCancel && (
          <button type="button" className="abtn ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="abtn" disabled={busy || (kind === 'text' && !text.trim())}>
          {busy ? 'Posting…' : 'Put it on the wall'}
        </button>
      </div>
    </form>
  );
}

export interface DrawPadHandle {
  /** The drawing as a PNG data URL, or undefined when nothing was drawn. */
  toPng(): string | undefined;
  clear(): void;
}

/** A finger-drawing canvas. Strokes are in the ink colour on a transparent background. */
export const DrawPad = forwardRef<DrawPadHandle, { height: number }>(function DrawPad(
  { height },
  ref,
) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth;
    c.width = Math.round(w * ratio);
    c.height = Math.round(height * ratio);
    const ctx = c.getContext('2d');
    ctx?.scale(ratio, ratio);
  }, [height]);

  const clear = () => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
    setDirty(false);
  };
  useImperativeHandle(
    ref,
    () => ({
      toPng: () => (dirty ? canvas.current?.toDataURL('image/png') : undefined),
      clear,
    }),
    [dirty],
  );

  const ink = () => getComputedStyle(canvas.current!).color;
  const pos = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = canvas.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    drawing.current = true;
    canvas.current!.setPointerCapture(e.pointerId);
    ctx.strokeStyle = ink();
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const [x, y] = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 0.1, y);
    ctx.stroke();
    setDirty(true);
  };
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    const [x, y] = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };
  const up = () => {
    drawing.current = false;
  };

  return (
    <div className="dp">
      <canvas
        ref={canvas}
        className="dp-canvas"
        style={{ height, touchAction: 'none' }}
        role="img"
        aria-label="Drawing pad. Draw with a finger."
        data-no-swipe
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      />
      {!dirty && <span className="dp-hint">Draw here</span>}
      {dirty && (
        <button type="button" className="dp-clear" onClick={clear}>
          Clear
        </button>
      )}
    </div>
  );
});
