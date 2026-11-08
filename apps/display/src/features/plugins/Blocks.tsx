/**
 * The one component that draws any plugin's blocks: a title, rows (icon, text, a smaller line
 * or a live countdown, buttons), presets and a dial. Used by Today cards, sheets and Ambient.
 */
import type { ConfigValue, PluginAction, PluginBlocks, PluginDial } from '@mantel/shared';
import { useState } from 'react';
import { useNow } from '../../app/Clock';
import { useOverlay } from '../../app/overlay';
import { PluginIcon } from './icons';
import { runPluginAction } from './store';

/** "4:05", "1:02:09"; never below 0:00. */
export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function Countdown({ to }: { to: string }) {
  const now = useNow(1000);
  return <span className="tnum">{formatCountdown(Date.parse(to) - now.getTime())}</span>;
}

/** Press a plugin's button with a toast for the answer. */
export function useRunAction(id: string) {
  const overlay = useOverlay();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, name: string, args: Record<string, ConfigValue>) => {
    setBusy(key);
    try {
      const message = await runPluginAction(id, name, args);
      if (message) overlay.toast(message);
    } catch (err) {
      overlay.toast(err instanceof Error ? err.message : 'That did not work.', { tone: 'warn' });
    } finally {
      setBusy(null);
    }
  };
  return { run, busy };
}

export type BlocksVariant = 'card' | 'sheet' | 'ambient';

export function BlocksView({
  plugin,
  blocks,
  variant,
  hideTitle,
}: {
  /** The plugin id, for its buttons. */
  plugin: string;
  blocks: PluginBlocks;
  variant: BlocksVariant;
  hideTitle?: boolean;
}) {
  const { run, busy } = useRunAction(plugin);
  const button = (a: PluginAction, key: string) => (
    <button
      key={key}
      type="button"
      className={`btn${a.tone === 'primary' ? ' primary' : ''}${a.tone === 'warn' ? ' danger' : ''}`}
      disabled={busy === key}
      onClick={(e) => {
        e.stopPropagation();
        void run(key, a.name, a.args);
      }}
    >
      {a.label}
    </button>
  );
  const warn = blocks.lines.some((l) => l.tone === 'warn');
  return (
    <div className="pb" data-variant={variant} data-tone={warn ? 'warn' : undefined}>
      {!hideTitle && (
        <div className="pb-head">
          <PluginIcon name={blocks.icon} />
          <b>{blocks.title}</b>
        </div>
      )}
      {blocks.progress !== undefined && (
        <div className="pb-progress" role="progressbar" aria-valuenow={blocks.progress * 100}>
          <i style={{ width: `${blocks.progress * 100}%` }} />
        </div>
      )}
      {blocks.lines.length > 0 && (
        <ul className="pb-lines">
          {blocks.lines.map((l, i) => {
            const key = l.id ?? String(i);
            return (
              <li key={key} data-tone={l.tone}>
                {l.icon && <PluginIcon name={l.icon} />}
                <div className="pb-text">
                  <b>{l.text}</b>
                  {l.countdownTo ? (
                    <span className="pb-count">
                      <Countdown to={l.countdownTo} />
                    </span>
                  ) : (
                    l.sub && <span>{l.sub}</span>
                  )}
                </div>
                {variant !== 'ambient' && l.actions.length > 0 && (
                  <div className="pb-acts">{l.actions.map((a, j) => button(a, `${key}:${j}`))}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!blocks.lines.length && blocks.empty && variant !== 'ambient' && (
        <p className="pb-empty">{blocks.empty}</p>
      )}
      {variant !== 'ambient' && blocks.actions.length > 0 && (
        <div className="pb-actions" role="group" aria-label="Start">
          {blocks.actions.map((a, j) => button(a, `a:${j}`))}
        </div>
      )}
      {variant === 'sheet' && blocks.dial && (
        <Dial
          dial={blocks.dial}
          busy={busy === 'dial'}
          onSubmit={(v) => run('dial', blocks.dial!.action, { value: v })}
        />
      )}
      {blocks.footer && variant !== 'ambient' && <p className="pb-foot">{blocks.footer}</p>}
    </div>
  );
}

const UNIT: Record<PluginDial['unit'], string> = { s: 'sec', min: 'min', h: 'h' };

/** A big number with minus and plus, a slider under it, and a submit button. */
function Dial({
  dial,
  busy,
  onSubmit,
}: {
  dial: PluginDial;
  busy: boolean;
  onSubmit: (value: number) => void;
}) {
  const [value, setValue] = useState(dial.value);
  const clamp = (n: number) => Math.max(dial.min, Math.min(dial.max, n));
  // Bigger steps past an hour, so 90 minutes is a few taps.
  const step = (dir: 1 | -1) => {
    const big = dial.unit === 'min' && value + dir * dial.step > 60 ? 5 : dial.step;
    setValue((v) => clamp(v + dir * big));
  };
  return (
    <div className="pb-dial">
      <span className="pb-dial-label">{dial.label}</span>
      <div className="pb-dial-row">
        <button type="button" className="btn icon" aria-label="Less" onClick={() => step(-1)}>
          <PluginIcon name="minus" />
        </button>
        <output className="tnum" aria-live="polite">
          {value}
          <small>{UNIT[dial.unit]}</small>
        </output>
        <button type="button" className="btn icon" aria-label="More" onClick={() => step(1)}>
          <PluginIcon name="plus" />
        </button>
      </div>
      <input
        type="range"
        aria-label={dial.label}
        min={dial.min}
        max={dial.max}
        step={dial.step}
        value={value}
        onChange={(e) => setValue(clamp(Number(e.target.value)))}
      />
      <button
        type="button"
        className="btn primary block"
        disabled={busy}
        onClick={() => onSubmit(value)}
      >
        {dial.submit} {value} {UNIT[dial.unit]}
      </button>
    </div>
  );
}
