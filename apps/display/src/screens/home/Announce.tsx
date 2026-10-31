import type { AnnounceTarget } from '@mantel/shared';
import { useState } from 'react';
import { Icon } from './icons';

const PRESETS = [
  'Dinner is ready',
  'Time to go',
  'Bedtime in ten minutes',
  'Come downstairs, please',
];

/** Alexa announcement sheet: a preset or a typed message, to some or all Echo devices. */
export function AnnounceSheet({
  targets,
  onSend,
  onClose,
}: {
  targets: AnnounceTarget[];
  onSend: (message: string, targets?: string[]) => Promise<boolean>;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [chosen, setChosen] = useState<string[]>(targets.map((t) => t.id));
  const [sending, setSending] = useState(false);
  const all = chosen.length === targets.length;

  const send = async (message: string) => {
    if (!message.trim() || !chosen.length) return;
    setSending(true);
    const ok = await onSend(message.trim(), all ? undefined : chosen);
    setSending(false);
    if (ok) onClose();
  };
  const toggle = (id: string) =>
    setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  return (
    <>
      <div className="hm-scrim" onClick={onClose} />
      <div
        className="hm-dialog hm-announce"
        role="dialog"
        aria-modal="true"
        aria-labelledby="announce-title"
      >
        <div className="hm-announce-head">
          <h3 id="announce-title">Announce</h3>
          <button className="x" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="hm-chips" aria-label="Speak on">
          {targets.map((t) => (
            <button key={t.id} aria-pressed={chosen.includes(t.id)} onClick={() => toggle(t.id)}>
              {t.name}
            </button>
          ))}
        </div>
        <div className="hm-presets">
          {PRESETS.map((p) => (
            <button key={p} disabled={sending || !chosen.length} onClick={() => void send(p)}>
              {p}
            </button>
          ))}
        </div>
        <form
          className="hm-announce-own"
          onSubmit={(ev) => {
            ev.preventDefault();
            void send(text);
          }}
        >
          <input
            value={text}
            maxLength={200}
            placeholder="Or type a message"
            aria-label="Announcement"
            onChange={(ev) => setText(ev.target.value)}
          />
          <button type="submit" disabled={sending || !text.trim() || !chosen.length}>
            Speak
          </button>
        </form>
      </div>
    </>
  );
}
