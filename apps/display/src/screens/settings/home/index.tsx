import {
  type IntegrationStatus,
  ApiRequestError,
  HomeConfig,
  type HomeConnectionStatus,
  type HomeDiscovery,
  type Person,
} from '@mantel/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { Section } from '../controls';
import { ConnectionCard } from './Connection';
import { DoorbellPicker, PresencePicker, ScenesPicker } from './Extras';
import './home-setup.css';
import { addCustomRoom } from './model';
import { RoomsPicker } from './Rooms';

const message = (err: unknown) =>
  err instanceof ApiRequestError ? err.message : 'Could not reach the server';

type Save = 'idle' | 'saving' | 'saved' | { error: string };

/**
 * Home Assistant set up with no YAML: connect with an address and a token, then tick rooms and
 * devices from what Home Assistant actually has. Saves apply live; the wall reloads itself.
 * Standalone (loads and saves its own data) so the settings page or a wizard can mount it.
 */
export function HomeSetupSection({
  people: peopleProp,
  onStatus,
}: {
  people?: Person[];
  /** The settings hub's integrations list, told when the connection changes. */
  onStatus?: (s: IntegrationStatus) => void;
} = {}) {
  const [status, setStatus] = useState<HomeConnectionStatus | null>(null);
  const [discovery, setDiscovery] = useState<HomeDiscovery | null>(null);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [saved, setSaved] = useState<HomeConfig | null>(null);
  const [draft, setDraft] = useState<HomeConfig | null>(null);
  const [people, setPeople] = useState<Person[]>(peopleProp ?? []);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<Save>('idle');
  const [yamlMsg, setYamlMsg] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const loadDiscovery = useCallback(async (s: HomeConnectionStatus) => {
    if (!s.enabled || s.state === 'not_set_up') {
      setDiscovery(null);
      setDiscoverError(null);
      return;
    }
    try {
      setDiscovery(await api.call('homeDiscover'));
      setDiscoverError(null);
    } catch (err) {
      setDiscovery(null);
      setDiscoverError(message(err));
    }
  }, []);

  useEffect(() => {
    let gone = false;
    Promise.all([
      api.call('homeConnection'),
      api.call('homeConfig'),
      peopleProp ? null : api.call('bootstrap').catch(() => null),
    ])
      .then(([s, cfg, boot]) => {
        if (gone) return;
        setStatus(s);
        setSaved(cfg);
        setDraft(cfg);
        if (boot) setPeople(boot.people);
        void loadDiscovery(s);
      })
      .catch((err: unknown) => !gone && setError(message(err)));
    return () => {
      gone = true;
    };
  }, [loadDiscovery, peopleProp]);

  const dirty = useMemo(
    () => !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved),
    [draft, saved],
  );
  const problem = useMemo(() => {
    if (!draft) return null;
    if (draft.doorbells.some((d) => !d.camera || !d.trigger))
      return 'Each doorbell needs a camera and a trigger.';
    const check = HomeConfig.safeParse(draft);
    return check.success ? null : check.error.issues[0]!.message;
  }, [draft]);

  const edit = (next: HomeConfig) => {
    setSaving('idle');
    setDraft(next);
  };

  const saveConnection = async (patch: { enabled?: boolean; url?: string; token?: string }) => {
    try {
      const s = await api.call('homeConnectionPut', { body: patch });
      setStatus(s);
      setError(null);
      void loadDiscovery(s);
      if (onStatus) {
        const { integrations } = await api.call('integrations');
        const mine = integrations.find((i) => i.id === 'homeassistant');
        if (mine) onStatus(mine);
      }
    } catch (err) {
      setError(message(err));
    }
  };

  const save = async () => {
    if (!draft || problem) return;
    setSaving('saving');
    try {
      const next = await api.call('homeConfigPut', { body: draft });
      setSaved(next);
      setDraft(next);
      setSaving('saved');
    } catch (err) {
      setSaving({ error: message(err) });
    }
  };

  const importYaml = async (text: string) => {
    try {
      const next = await api.call('homeConfigImportYaml', { body: { yaml: text } });
      setSaved(next);
      setDraft(next);
      setYamlMsg(`Imported ${next.areas.length} rooms. The Home screen is updating.`);
    } catch (err) {
      setYamlMsg(message(err));
    }
  };

  const exportYaml = async (how: 'download' | 'copy') => {
    try {
      const { yaml } = await api.call('homeConfigExportYaml');
      if (how === 'copy') {
        await navigator.clipboard.writeText(yaml);
        setYamlMsg('Copied home.yaml to the clipboard.');
        return;
      }
      const url = URL.createObjectURL(new Blob([yaml], { type: 'application/yaml' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'home.yaml';
      a.click();
      URL.revokeObjectURL(url);
      setYamlMsg('Downloaded home.yaml.');
    } catch (err) {
      setYamlMsg(message(err));
    }
  };

  const hint =
    'Connect with the address and a token, then tick the rooms and devices for the wall. No files to edit.';

  if (error && !status)
    return (
      <Section title="Home Assistant" hint={hint}>
        <p className="set-err">{error}</p>
      </Section>
    );
  if (!status || !draft)
    return (
      <Section title="Home Assistant" hint={hint}>
        <p className="set-hint">Loading…</p>
      </Section>
    );

  const ready = status.enabled && status.state !== 'not_set_up';

  return (
    <Section
      title="Home Assistant"
      hint={hint}
      action={
        <span className={`set-badge hs-badge is-${status.state}`}>
          {status.state === 'connected'
            ? 'Connected'
            : status.state === 'disabled'
              ? 'Off'
              : status.state === 'error'
                ? 'Problem'
                : status.state === 'connecting'
                  ? 'Connecting'
                  : 'Not set up'}
        </span>
      }
    >
      {error && <p className="set-err">{error}</p>}
      <ConnectionCard
        status={status}
        onSave={saveConnection}
        onTest={(req) => api.call('homeConnectionTest', { body: req })}
      />

      {ready && (
        <div className="hs-picker">
          <div className="set-sec-head hs-block-head">
            <div className="set-label">
              Rooms
              <span className="set-hint">
                Turn on the rooms to show, open one to choose what is in it, drag to reorder.
              </span>
            </div>
            <div className="set-row hs-inline">
              {discoverError && (
                <button
                  type="button"
                  className="set-btn"
                  onClick={() => void loadDiscovery(status)}
                >
                  Try again
                </button>
              )}
              <button
                type="button"
                className="set-btn"
                onClick={() => edit(addCustomRoom(draft, 'New room'))}
              >
                Add a room of your own
              </button>
            </div>
          </div>
          {discoverError && (
            <p className="set-err">
              Could not read rooms from Home Assistant: {discoverError}. Rooms you set up before are
              still listed.
            </p>
          )}
          {!discovery && !discoverError && <p className="set-hint">Reading rooms and devices…</p>}
          <RoomsPicker config={draft} discovery={discovery} onChange={edit} />
          <ScenesPicker config={draft} discovery={discovery} onChange={edit} />
          <DoorbellPicker config={draft} discovery={discovery} onChange={edit} />
          <PresencePicker config={draft} discovery={discovery} people={people} onChange={edit} />
        </div>
      )}

      <div className="hs-block hs-yaml">
        <div className="set-label">
          Like files?
          <span className="set-hint">
            The same setup as a home.yaml, to back up, share or edit by hand.
          </span>
        </div>
        <div className="set-row">
          <button type="button" className="set-btn" onClick={() => file.current?.click()}>
            Import home.yaml
          </button>
          <input
            ref={file}
            type="file"
            accept=".yaml,.yml,text/yaml"
            hidden
            aria-label="Import home.yaml"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) await importYaml(await f.text());
            }}
          />
          <button type="button" className="set-btn" onClick={() => void exportYaml('download')}>
            Download
          </button>
          <button type="button" className="set-btn" onClick={() => void exportYaml('copy')}>
            Copy
          </button>
          {yamlMsg && (
            <span className="set-hint" role="status">
              {yamlMsg}
            </span>
          )}
        </div>
      </div>

      <div className="hs-save" aria-live="polite">
        <span className="set-bar-msg">
          {problem
            ? problem
            : saving === 'saving'
              ? 'Saving…'
              : saving === 'saved'
                ? 'Saved. The Home screen is updating.'
                : typeof saving === 'object'
                  ? saving.error
                  : dirty
                    ? 'Unsaved Home Assistant changes'
                    : ''}
        </span>
        <button
          type="button"
          className="set-btn"
          disabled={!dirty || saving === 'saving'}
          onClick={() => {
            setDraft(saved);
            setSaving('idle');
          }}
        >
          Discard
        </button>
        <button
          type="button"
          className="set-btn primary"
          disabled={!dirty || !!problem || saving === 'saving'}
          onClick={() => void save()}
        >
          Save rooms and devices
        </button>
      </div>
    </Section>
  );
}
