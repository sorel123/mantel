/**
 * Adding a recipe: paste a link (the usual way), take or pick a photo of a cookbook page or a
 * card, or paste the text. The server reads it and saves it; the new recipe opens.
 */
import { useRef, useState } from 'react';
import { useOverlay } from '../../../app/overlay';
import { readPhoto } from '../../companion/image';
import { Svg } from '../icons';
import { errorText, importRecipe } from './data';
import { RecipeIcon } from './icons';

type Mode = 'link' | 'photo' | 'text';

/** Reading the clipboard needs a secure page (https or this computer). */
const canPaste =
  typeof navigator !== 'undefined' && !!navigator.clipboard && window.isSecureContext;

const looksLikeLink = (s: string) => /^https?:\/\/\S+\.\S+/i.test(s.trim());

export function AddRecipe({
  onDone,
  onCancel,
  compact = false,
}: {
  /** With the new recipe's id, or nothing. */
  onDone: (id?: string) => void;
  onCancel?: () => void;
  /** The phone's smaller layout. */
  compact?: boolean;
}) {
  const { toast } = useOverlay();
  const [mode, setMode] = useState<Mode>('link');
  const [link, setLink] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const run = async (label: string, body: Parameters<typeof importRecipe>[0]) => {
    setBusy(label);
    setError(null);
    try {
      const res = await importRecipe(body);
      toast(
        res.existing
          ? `${res.recipe.title} is already in the box`
          : `Saved ${res.recipe.title}. ${res.message}`,
      );
      setLink('');
      setText('');
      onDone(res.recipe.id);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const paste = async () => {
    try {
      const t = (await navigator.clipboard.readText()).trim();
      if (looksLikeLink(t)) {
        setLink(t);
        void run('Reading the page…', { url: t });
      } else if (t) {
        setMode('text');
        setText(t);
      } else setError('The clipboard is empty. Copy a link to a recipe first.');
    } catch {
      setError('Paste the link into the box with a long press, then tap Add.');
    }
  };

  return (
    <section className={`card rc-add${compact ? ' compact' : ''}`} aria-label="Add a recipe">
      <div className="rc-add-head">
        <div className="seg" role="group" aria-label="Add from">
          {(
            [
              ['link', 'Link', RecipeIcon.link],
              ['photo', 'Photo', RecipeIcon.camera],
              ['text', 'Text', RecipeIcon.text],
            ] as const
          ).map(([m, label, icon]) => (
            <button
              key={m}
              type="button"
              className="btn"
              aria-pressed={mode === m}
              onClick={() => {
                setMode(m);
                setError(null);
              }}
            >
              <Svg>{icon}</Svg> {label}
            </button>
          ))}
        </div>
        <span className="grow" />
        {onCancel && (
          <button type="button" className="btn quiet" onClick={onCancel} disabled={!!busy}>
            Cancel
          </button>
        )}
      </div>

      {busy ? (
        <div className="rc-reading" role="status">
          <span className="rc-spinner" aria-hidden="true">
            <Svg>{RecipeIcon.sparkle}</Svg>
          </span>
          {busy}
        </div>
      ) : mode === 'link' ? (
        <form
          className="rc-add-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (looksLikeLink(link)) void run('Reading the page…', { url: link.trim() });
            else setError('That does not look like a link. Copy it from the address bar.');
          }}
        >
          <input
            className="input"
            type="url"
            inputMode="url"
            placeholder="https://… a link to any recipe"
            aria-label="Recipe link"
            value={link}
            onChange={(e) => setLink(e.target.value)}
          />
          {!link && canPaste && (
            <button type="button" className="btn" onClick={() => void paste()}>
              <Svg>{RecipeIcon.paste}</Svg> Paste
            </button>
          )}
          <button type="submit" className="btn primary" disabled={!link.trim()}>
            Add
          </button>
        </form>
      ) : mode === 'photo' ? (
        <div className="rc-add-row">
          <p className="muted grow">
            A cookbook page or a recipe card. Claude reads it, so check the amounts after.
          </p>
          <input
            ref={file}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            aria-label="Recipe photo"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try {
                void run('Claude is reading the photo…', { image: await readPhoto(f, 2000) });
              } catch (err) {
                setError(errorText(err));
              }
            }}
          />
          <button type="button" className="btn primary" onClick={() => file.current?.click()}>
            <Svg>{RecipeIcon.camera}</Svg> Take or choose a photo
          </button>
        </div>
      ) : (
        <form
          className="rc-add-text"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim().length >= 20) void run('Reading the recipe…', { text: text.trim() });
            else setError('Paste the whole recipe: a title, the ingredients and the steps.');
          }}
        >
          <textarea
            className="input"
            rows={compact ? 6 : 5}
            aria-label="Recipe text"
            placeholder={
              'Grandma’s scones\nIngredients\n2 cups flour\n…\nMethod\nRub the butter into the flour…'
            }
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" className="btn primary" disabled={!text.trim()}>
            Read it
          </button>
        </form>
      )}
      {error && (
        <p className="rc-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
