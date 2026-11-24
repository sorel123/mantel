/**
 * The phone's Inbox tab (v4 K): send something in (paste text, a photo, a PDF or calendar file),
 * and check what is waiting, wherever it came from: forwarded email, the share sheet, the iPhone
 * Shortcut, or a photo. Each item opens the same review the wall uses, stacked for a phone.
 */
import type { InboxCommitResponse, InboxItem } from '@mantel/shared';
import { ApiRequestError } from '@mantel/shared';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { EASE, STD, motionOr, useMotionPreference } from '../../../app/motion';
import { useOverlay } from '../../../app/overlay';
import { InboxReview, InboxRow, patchItem, useInbox, useUndo } from '../../../features/inbox';
import { api } from '../../../lib/api';
import { sendFile } from './send';
import { takeShared } from './share';
import './inbox-tab.css';

export function InboxTab() {
  const { waiting, added, loaded, error } = useInbox();
  const overlay = useOverlay();
  const undo = useUndo(overlay.toast);
  const reduced = useMotionPreference();
  const [open, setOpen] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);

  // Something shared to Mantel from another app (Android and desktop share sheets).
  useEffect(() => {
    void takeShared()
      .then((n) => {
        if (n) overlay.toast(`Shared ${n === 1 ? 'it' : `${n} things`} to the inbox. Reading now…`);
      })
      .catch((err: unknown) =>
        setProblem(err instanceof Error ? err.message : 'Could not read what was shared.'),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendText = async () => {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    setProblem(null);
    try {
      const { item } = await api.call('inboxCreate', { body: { text: t, source: 'text' } });
      patchItem(item);
      setText('');
      setOpen(item.id);
    } catch (err) {
      setProblem(err instanceof ApiRequestError ? err.message : 'Could not reach Mantel.');
    } finally {
      setBusy(false);
    }
  };

  const onFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!list.length) return;
    setBusy(true);
    setProblem(null);
    try {
      let last: InboxItem | null = null;
      for (const f of list)
        last = await sendFile(f, e.target === camera.current ? 'photo' : 'share');
      if (list.length === 1 && last) setOpen(last.id);
      else overlay.toast(`Sent ${list.length} things to the inbox.`);
    } catch (err) {
      setProblem(
        err instanceof ApiRequestError || err instanceof Error
          ? err.message
          : 'Could not send that.',
      );
    } finally {
      setBusy(false);
    }
  };

  const current = open ? (waiting.find((i) => i.id === open) ?? null) : null;
  const committed = (r: InboxCommitResponse) => {
    undo(r);
    setOpen(null);
  };

  return (
    <div className="ibx-tab">
      <AnimatePresence mode="wait" initial={false}>
        {current ? (
          <motion.div
            key="review"
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={motionOr(reduced, { duration: STD, ease: EASE })}
          >
            <button type="button" className="alink ibx-back" onClick={() => setOpen(null)}>
              ‹ Inbox
            </button>
            <InboxReview
              item={current}
              layout="phone"
              onCommitted={committed}
              onDismissed={() => {
                setOpen(null);
                overlay.toast('Dismissed.');
              }}
            />
          </motion.div>
        ) : (
          <motion.div
            key="list"
            initial={{ opacity: 0, x: -24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={motionOr(reduced, { duration: STD, ease: EASE })}
          >
            <header className="ahead">
              <h1 className="h1">Inbox</h1>
              <p className="amuted">
                Anything with a date or a list on it. Nothing goes on the calendar until you say
                yes.
              </p>
            </header>

            <section className="card apanel ibx-send" aria-label="Send something in">
              <textarea
                className="ainput"
                rows={3}
                value={text}
                placeholder="Paste a message, a text from school, or type it: Dentist Tuesday at 3"
                aria-label="Text to read"
                onChange={(e) => setText(e.target.value)}
              />
              <div className="ibx-send-row">
                <button
                  type="button"
                  className="abtn"
                  disabled={busy || !text.trim()}
                  onClick={() => void sendText()}
                >
                  {busy ? 'Sending…' : 'Read it'}
                </button>
                <button
                  type="button"
                  className="abtn ghost"
                  disabled={busy}
                  onClick={() => camera.current?.click()}
                >
                  Photo
                </button>
                <button
                  type="button"
                  className="abtn ghost"
                  disabled={busy}
                  onClick={() => files.current?.click()}
                >
                  File
                </button>
              </div>
              <input
                ref={camera}
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={(e) => void onFiles(e)}
                data-testid="inbox-camera"
              />
              <input
                ref={files}
                type="file"
                multiple
                accept="image/*,.heic,.heif,application/pdf,.pdf,text/calendar,.ics"
                hidden
                onChange={(e) => void onFiles(e)}
                data-testid="inbox-file"
              />
              {problem && (
                <p className="mi-problem" role="alert">
                  {problem}
                </p>
              )}
            </section>

            <section className="ibx-list" aria-label="Waiting to be checked">
              {!loaded ? (
                [0, 1].map((i) => <div key={i} className="skeleton" style={{ height: 68 }} />)
              ) : error && !waiting.length ? (
                <p className="mi-problem">{error}</p>
              ) : waiting.length === 0 ? (
                <div className="card apanel ibx-empty" role="status">
                  <b>Nothing waiting</b>
                  <p className="amuted">
                    Forward an email to Mantel, share a PDF or photo to it from another app, or
                    paste a message above.
                  </p>
                </div>
              ) : (
                <AnimatePresence initial={false}>
                  {waiting.map((i) => (
                    <motion.div
                      key={i.id}
                      layout
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={motionOr(reduced, { duration: STD, ease: EASE })}
                    >
                      <InboxRow item={i} onOpen={() => setOpen(i.id)} />
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </section>

            {added.length > 0 && (
              <section className="ibx-list" aria-label="Added lately">
                <div className="eyebrow">Added lately</div>
                {added.slice(0, 8).map((i) => (
                  <InboxRow key={i.id} item={i} onOpen={() => undefined} />
                ))}
              </section>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
