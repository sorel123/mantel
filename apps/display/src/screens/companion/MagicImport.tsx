/**
 * Magic Import: a photo of a flyer, schedule, list or menu becomes things to add. The photo is
 * read by Claude on the server (only when a key is set). Since v4 K it goes into the inbox and is
 * reviewed with the inbox's review (`features/inbox`), so there is one review surface; nothing
 * is written until Add is pressed, and Undo follows for ten seconds.
 *
 * Used on the companion's Calendar and Lists tabs and in a sheet on the wall.
 */
import type {
  ImportCommitResponse,
  ImportHint,
  InboxCommitResponse,
  ResponseOf,
} from '@mantel/shared';
import { ApiRequestError } from '@mantel/shared';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { api } from '../../lib/api';
import { useOverlay } from '../../app/overlay';
import { InboxReview, patchItem, useInbox, useUndo } from '../../features/inbox';
import { readPhoto } from './image';

type Status = ResponseOf<'importStatus'>;

type Step =
  | { kind: 'pick' }
  | { kind: 'sending'; preview: string }
  | { kind: 'review'; id: string }
  | { kind: 'done'; result: ImportCommitResponse }
  | { kind: 'error'; message: string; preview?: string };

/** Whether this server can read a photo right now. */
export function useImportStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    api
      .call('importStatus')
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);
  return status;
}

export function MagicImport({
  hint = 'auto',
  onDone,
  compact = false,
}: {
  hint?: ImportHint;
  /** Called after a commit, with what was created. */
  onDone?: (result: ImportCommitResponse) => void;
  /** Just the camera button; the rest opens in place once a photo is picked. */
  compact?: boolean;
}) {
  const status = useImportStatus();
  const undo = useUndo(useOverlay().toast);
  const [step, setStep] = useState<Step>({ kind: 'pick' });
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    let image: string;
    try {
      image = await readPhoto(file);
    } catch (err) {
      setStep({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      return;
    }
    setStep({ kind: 'sending', preview: image });
    try {
      // v4 K: a photo lands in the inbox like everything else, and is reviewed there.
      const { item } = await api.call('inboxCreate', {
        body: { file: image, hint, source: 'photo', name: file.name || undefined },
      });
      patchItem(item);
      setStep({ kind: 'review', id: item.id });
    } catch (err) {
      setStep({
        kind: 'error',
        preview: image,
        message:
          err instanceof ApiRequestError
            ? err.message
            : 'Could not reach Mantel. Check the connection and try again.',
      });
    }
  };

  const inputs = (
    <>
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => void onFile(e)}
        data-testid="import-camera"
      />
      <input
        ref={library}
        type="file"
        accept="image/*,.heic,.heif"
        hidden
        onChange={(e) => void onFile(e)}
        data-testid="import-file"
      />
    </>
  );

  if (step.kind === 'pick') {
    const ready = status?.ready ?? false;
    return (
      <div className={`mi mi-pick${compact ? ' compact' : ''}`}>
        {inputs}
        {!compact && (
          <div className="mi-lead">
            <h2 className="h2">Read a photo</h2>
            <p className="amuted">
              Snap a school flyer, a team schedule, a menu or a shopping list. Mantel reads it and
              shows you what to add before anything is saved.
            </p>
          </div>
        )}
        <div className="mi-buttons">
          <button
            type="button"
            className="abtn"
            disabled={!ready}
            onClick={() => camera.current?.click()}
          >
            <Cam /> Take a photo
          </button>
          <button
            type="button"
            className="abtn ghost"
            disabled={!ready}
            onClick={() => library.current?.click()}
          >
            Choose a photo
          </button>
        </div>
        {status && !status.ready && (
          <p className="mi-note" role="status">
            {status.message}{' '}
            <a href="/settings#quips" target="_blank" rel="noreferrer">
              Open Settings
            </a>
          </p>
        )}
        {status?.ready && !status.mock && (
          <p className="mi-note">
            The photo is sent to Anthropic (Claude) to be read, then deleted. Nothing is saved until
            you press Add.
          </p>
        )}
      </div>
    );
  }

  if (step.kind === 'sending')
    return (
      <div className="mi mi-reading" role="status" aria-live="polite">
        <img src={step.preview} alt="" className="mi-preview" />
        <div className="mi-spin" aria-hidden />
        <p>Reading the photo…</p>
      </div>
    );

  if (step.kind === 'error')
    return (
      <div className="mi mi-error">
        {step.preview && <img src={step.preview} alt="" className="mi-preview small" />}
        <p role="alert">{step.message}</p>
        <button type="button" className="abtn" onClick={() => setStep({ kind: 'pick' })}>
          Try another photo
        </button>
      </div>
    );

  if (step.kind === 'done') {
    const r = step.result;
    const bits = [
      r.events.length && `${r.events.length} event${r.events.length === 1 ? '' : 's'}`,
      r.items && `${r.items} list item${r.items === 1 ? '' : 's'}`,
      r.meals && `${r.meals} meal${r.meals === 1 ? '' : 's'}`,
    ].filter(Boolean);
    return (
      <div className="mi mi-done" role="status">
        <div className="mi-check" aria-hidden>
          ✓
        </div>
        <h2 className="h2">{bits.length ? `Added ${bits.join(', ')}` : 'Nothing added'}</h2>
        {r.problems.map((p) => (
          <p key={p} className="mi-problem">
            {p}
          </p>
        ))}
        <button type="button" className="abtn ghost" onClick={() => setStep({ kind: 'pick' })}>
          Read another photo
        </button>
      </div>
    );
  }

  return (
    <Review
      id={step.id}
      onCommitted={(result) => {
        undo(result);
        setStep({ kind: 'done', result });
        onDone?.(result);
      }}
      onBack={() => setStep({ kind: 'pick' })}
    />
  );
}

/** The inbox review of the photo just sent, kept live as it is read. */
function Review({
  id,
  onCommitted,
  onBack,
}: {
  id: string;
  onCommitted: (r: InboxCommitResponse) => void;
  onBack: () => void;
}) {
  const { items } = useInbox();
  const item = items.find((i) => i.id === id);
  if (!item)
    return (
      <div className="mi mi-reading" role="status">
        <div className="mi-spin" aria-hidden />
        <p>Reading the photo…</p>
      </div>
    );
  return (
    <div className="mi mi-review">
      <InboxReview item={item} layout="phone" onCommitted={onCommitted} onDismissed={onBack} />
    </div>
  );
}

export function Cam() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="mi-cam">
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}
