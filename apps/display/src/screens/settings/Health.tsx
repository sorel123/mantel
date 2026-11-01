import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { errorText, getHealthDetails } from './client';
import type { HealthDetails, UpdateCheckResponse } from '@mantel/shared';
import { CopyButton, Section, StatusBadge } from './controls';

const ago = (iso: string | null) => {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 36) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
};

const uptime = (s: number) => {
  if (s < 90) return `${Math.round(s)} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  if (s < 172_800) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86_400)} days`;
};

/** Health: what each integration last did, the last log lines, and a Copy diagnostics button. */
export function HealthSection({ version, mock }: { version: string; mock: boolean }) {
  const [health, setHealth] = useState<HealthDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateCheckResponse | null>(null);
  useEffect(() => {
    api
      .call('updateCheck')
      .then(setUpdate)
      .catch(() => setUpdate(null));
  }, []);
  const load = useCallback(() => {
    getHealthDetails()
      .then((h) => {
        setHealth(h);
        setError(null);
      })
      .catch((err: unknown) => setError(errorText(err)));
  }, []);
  useEffect(load, [load]);

  const diagnostics = JSON.stringify(
    {
      version,
      mock,
      at: new Date().toISOString(),
      userAgent: navigator.userAgent,
      screen: `${screen.width}x${screen.height}`,
      health,
    },
    null,
    2,
  );

  return (
    <Section
      id="health"
      title="Health"
      hint="If something on the wall looks wrong, start here. Copy diagnostics when asking for help; it holds no secrets."
      action={
        <span className="set-pair">
          <button type="button" className="set-btn" onClick={load}>
            Refresh
          </button>
          <CopyButton text={diagnostics} label="Copy diagnostics" />
        </span>
      }
    >
      {error && <p className="set-err">{error}</p>}
      <div className="set-field">
        <span className="set-label">
          Mantel {health?.version ?? version}
          <span className="set-hint">
            {health ? `Up ${uptime(health.uptimeSeconds)}` : 'Loading…'}
            {mock ? ' · mock data' : ''}
            {health?.publicUrl ? ` · ${health.publicUrl}` : ''}
          </span>
        </span>
      </div>
      {update?.available && update.url && (
        <div className="set-field">
          <span className="set-label">
            Mantel {update.latest} is out
            <span className="set-hint">
              You have {update.current}. Download the new version and run it over the old one; your
              settings and keys stay.
            </span>
          </span>
          <a className="set-btn" href={update.url} target="_blank" rel="noreferrer">
            Get it
          </a>
        </div>
      )}
      {health?.integrations.map((i) => (
        <div className="set-field" key={i.id}>
          <span className="set-label">
            {i.id}
            <span className="set-hint">
              {i.summary}
              {i.lastOkAt ? ` · last OK ${ago(i.lastOkAt)}` : ''}
            </span>
            {i.lastError && <span className="set-hint set-invalid">{i.lastError}</span>}
          </span>
          <StatusBadge state={i.enabled ? i.state : 'disabled'} />
        </div>
      ))}
      {health && health.logTail.length > 0 && (
        <div className="set-sub wide">
          <div className="set-label">Last log lines</div>
          <pre className="set-log">
            {health.logTail
              .map((l) => `${l.at.slice(11, 19)} ${l.level.padEnd(5)} ${l.message}`)
              .join('\n')}
          </pre>
        </div>
      )}
    </Section>
  );
}
