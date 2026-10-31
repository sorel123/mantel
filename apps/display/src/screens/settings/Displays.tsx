import { ApiRequestError, type Device, type ResponseOf, type ScreenConfig } from '@mantel/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { SCREEN_LABELS } from './contract';
import { Collapse, Section, Seg, TextInput } from './controls';

const ago = (iso: string | null) => {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 36) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
};

const message = (err: unknown) =>
  err instanceof ApiRequestError ? err.message : 'Could not reach the server';

/**
 * Paired displays: rename or revoke one, give it its own look, default screen and fit, show a
 * code to pair another, reload them all.
 */
export function Displays({ screens = [] }: { screens?: ScreenConfig[] }) {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<ResponseOf<'pairingCode'> | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [reloaded, setReloaded] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  const refresh = useCallback(() => {
    api
      .call('devices')
      .then((r) => setDevices(r.devices))
      .catch((err: unknown) => setError(message(err)));
  }, []);
  useEffect(refresh, [refresh]);

  // A second tap confirms; the first arms the button for a few seconds.
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(null), 4000);
    return () => clearTimeout(t);
  }, [confirming]);

  const revoke = async (d: Device) => {
    if (confirming !== d.id) return setConfirming(d.id);
    setConfirming(null);
    try {
      await api.call('deviceRevoke', { params: { id: d.id } });
      if (d.current) location.reload();
      else refresh();
    } catch (err) {
      setError(message(err));
    }
  };

  const rename = async () => {
    if (!renaming) return;
    const name = renaming.name.trim();
    setRenaming(null);
    if (!name) return;
    try {
      await api.call('deviceRename', { params: { id: renaming.id }, body: { name } });
      refresh();
    } catch (err) {
      setError(message(err));
    }
  };

  const override = async (
    d: Device,
    patch: Partial<Pick<Device, 'look' | 'defaultScreen' | 'fit' | 'scale'>>,
  ) => {
    try {
      const body = Object.fromEntries(
        Object.entries(patch).map(([k, v]) => [k, v === undefined ? null : v]),
      );
      const { device } = await api.call('deviceRename', { params: { id: d.id }, body });
      setDevices((list) => list?.map((x) => (x.id === device.id ? device : x)) ?? list);
    } catch (err) {
      setError(message(err));
    }
  };

  const showCode = () =>
    api
      .call('pairingCode')
      .then(setCode)
      .catch((err: unknown) => setError(message(err)));

  const reloadAll = () =>
    api
      .call('displayReload')
      .then((r) => setReloaded(r.clients))
      .catch((err: unknown) => setError(message(err)));

  const active = devices?.filter((d) => !d.revokedAt) ?? [];
  const revoked = devices?.filter((d) => d.revokedAt) ?? [];
  const screenChoices = (screens.length ? screens : []).filter((s) => s.enabled);

  return (
    <Section
      id="displays"
      title="Displays"
      hint="Every tablet, phone or browser that has paired. Revoking signs it out at once."
      action={
        <button type="button" className="set-btn" onClick={reloadAll}>
          Reload all displays
        </button>
      }
    >
      {error && <p className="set-err">{error}</p>}
      {reloaded !== null && (
        <p className="set-hint">
          Sent a reload to {reloaded} connected display{reloaded === 1 ? '' : 's'}.
        </p>
      )}
      {devices === null && !error && <p className="set-hint">Loading…</p>}
      {devices !== null && active.length === 0 && (
        <p className="set-hint">
          No paired displays. In mock mode this browser is let in without pairing.
        </p>
      )}
      {active.map((d) =>
        renaming?.id === d.id ? (
          <form
            className="set-field"
            key={d.id}
            onSubmit={(e) => {
              e.preventDefault();
              void rename();
            }}
          >
            <TextInput
              label="Display name"
              value={renaming.name}
              maxLength={60}
              onChange={(name) => setRenaming({ id: d.id, name })}
            />
            <span className="set-pair">
              <button type="button" className="set-btn quiet" onClick={() => setRenaming(null)}>
                Cancel
              </button>
              <button type="submit" className="set-btn primary">
                Save name
              </button>
            </span>
          </form>
        ) : (
          <div className="set-device" key={d.id}>
            <div className="set-field">
              <span className="set-label">
                {d.name}
                {d.current && <span className="set-badge">This display</span>}
                <span className="set-hint">
                  Paired {new Date(d.createdAt).toLocaleDateString()} · last seen{' '}
                  {ago(d.lastSeenAt)}
                </span>
              </span>
              <button
                type="button"
                className="set-btn quiet"
                onClick={() => setRenaming({ id: d.id, name: d.name })}
              >
                Rename
              </button>
              <button
                type="button"
                className={`set-btn${confirming === d.id ? ' danger' : ''}`}
                onClick={() => revoke(d)}
              >
                {confirming === d.id ? 'Tap again to revoke' : 'Revoke'}
              </button>
            </div>
            <Collapse
              title={`Just this display`}
              hint={
                d.look || d.defaultScreen || d.fit
                  ? `Overrides: ${[d.look, d.defaultScreen && (SCREEN_LABELS[d.defaultScreen] ?? d.defaultScreen), d.fit].filter(Boolean).join(', ')}`
                  : 'Uses the household settings. Give it its own look, start screen or fit.'
              }
            >
              <div className="set-field">
                <span className="set-label">Look</span>
                <Seg
                  label={`${d.name} look`}
                  value={d.look ?? 'default'}
                  options={[
                    ['default', 'Same as settings'],
                    ['auto', 'Auto'],
                    ['daylight', 'Daylight'],
                    ['dusk', 'Dusk'],
                  ]}
                  onChange={(v) => void override(d, { look: v === 'default' ? undefined : v })}
                />
              </div>
              <div className="set-field">
                <span className="set-label">Start screen</span>
                <Seg
                  label={`${d.name} start screen`}
                  value={d.defaultScreen ?? 'default'}
                  options={[
                    ['default', 'Same as settings'],
                    ...screenChoices.map((s): [string, string] => [
                      s.id,
                      s.label ?? SCREEN_LABELS[s.id] ?? s.id,
                    ]),
                  ]}
                  onChange={(v) =>
                    void override(d, { defaultScreen: v === 'default' ? undefined : v })
                  }
                />
              </div>
              <div className="set-field">
                <span className="set-label">Fit</span>
                <Seg
                  label={`${d.name} fit`}
                  value={d.fit ?? 'default'}
                  options={[
                    ['default', 'Same as settings'],
                    ['fit', 'Fit'],
                    ['fill', 'Fill'],
                    ['scale', 'Scale'],
                  ]}
                  onChange={(v) => void override(d, { fit: v === 'default' ? undefined : v })}
                />
              </div>
              {d.fit === 'scale' && (
                <div className="set-field">
                  <span className="set-label">Scale</span>
                  <span className="set-pair grow">
                    <input
                      className="set-range"
                      type="range"
                      min={90}
                      max={130}
                      step={5}
                      aria-label={`${d.name} scale`}
                      value={Math.round((d.scale ?? 1) * 100)}
                      style={
                        {
                          '--v': `${((Math.round((d.scale ?? 1) * 100) - 90) / 40) * 100}%`,
                        } as React.CSSProperties
                      }
                      onChange={(e) => void override(d, { scale: e.target.valueAsNumber / 100 })}
                    />
                    <span className="set-num tnum">{Math.round((d.scale ?? 1) * 100)}%</span>
                  </span>
                </div>
              )}
            </Collapse>
          </div>
        ),
      )}
      {revoked.length > 0 && (
        <p className="set-hint">
          Revoked:{' '}
          {revoked
            .slice(0, 5)
            .map((d) => `${d.name} (${ago(d.revokedAt)})`)
            .join(', ')}
        </p>
      )}

      <div className="set-field">
        <span className="set-label">
          Pair another display
          <span className="set-hint">
            Open this server on the new tablet and enter the admin PIN, or this one-time code. The
            code changes every 15 minutes and works once.
          </span>
        </span>
        {code ? (
          <span className="set-code tnum" aria-label="Pairing code">
            {code.code}
          </span>
        ) : (
          <button type="button" className="set-btn" onClick={showCode}>
            Show a code
          </button>
        )}
      </div>
    </Section>
  );
}
