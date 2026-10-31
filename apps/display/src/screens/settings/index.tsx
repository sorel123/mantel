import { ApiRequestError, Settings, type Calendar } from '@mantel/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pairing } from '../../app/Pairing';
import { api } from '../../lib/api';
import { useThemeMode } from '../../lib/theme';
import { Displays } from './Displays';
import { HomeSetupSection } from './home';
import { Destinations, Features, General, People, Schedule } from './sections';
import './settings.css';

type Load =
  | { status: 'loading' }
  | { status: 'unpaired' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      saved: Settings;
      calendars: Calendar[];
      version: string;
      mock: boolean;
    };

const errorText = (err: unknown) =>
  err instanceof ApiRequestError ? err.message : 'Could not reach the server';

/**
 * The setup page at `/settings`: schedule, people, destinations, feature flags and paired
 * displays. A normal scrolling page, so it works from a phone or laptop as well as the wall.
 * Saving tells every display to reload so the new settings apply at once.
 */
export function SettingsPage() {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [draft, setDraft] = useState<Settings | null>(null);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | { error: string }>('idle');

  const fetchAll = useCallback(() => {
    setLoad({ status: 'loading' });
    Promise.all([api.call('settings'), api.call('bootstrap')])
      .then(([settings, boot]) => {
        setLoad({
          status: 'ready',
          saved: settings,
          calendars: boot.calendars,
          version: boot.version,
          mock: boot.mock,
        });
        setDraft(settings);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiRequestError && err.status === 401) setLoad({ status: 'unpaired' });
        else setLoad({ status: 'error', message: errorText(err) });
      });
  }, []);
  useEffect(fetchAll, [fetchAll]);
  useThemeMode(draft?.theme ?? 'auto');

  const saved = load.status === 'ready' ? load.saved : null;
  const dirty = useMemo(
    () => !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved),
    [draft, saved],
  );
  const problem = useMemo(() => {
    if (!draft) return null;
    const check = Settings.safeParse(draft);
    if (check.success) return null;
    const issue = check.error.issues[0]!;
    return `${issue.path.join(' › ')}: ${issue.message}`;
  }, [draft]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = async () => {
    if (!draft || problem || load.status !== 'ready') return;
    setSaving('saving');
    try {
      const next = await api.call('settingsPut', { body: draft });
      setLoad({ ...load, saved: next });
      setDraft(next);
      setSaving('saved');
    } catch (err) {
      setSaving({ error: errorText(err) });
    }
  };

  if (load.status === 'unpaired')
    return (
      <Page>
        <div className="set-center">
          <Pairing onPaired={fetchAll} />
        </div>
      </Page>
    );
  if (load.status === 'error')
    return (
      <Page>
        <div className="set-center card set-msg">
          <h1 className="h2">Can't reach the server</h1>
          <p>{load.message}</p>
          <button className="set-btn primary" onClick={fetchAll}>
            Retry
          </button>
        </div>
      </Page>
    );
  if (load.status === 'loading' || !draft)
    return (
      <Page>
        <div className="set-center eyebrow">Loading</div>
      </Page>
    );

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSaving('idle');
    setDraft({ ...draft, [key]: value });
  };

  return (
    <Page>
      <header className="set-head">
        <div>
          <div className="eyebrow">
            Mantel {load.version}
            {load.mock ? ' · mock data' : ''}
          </div>
          <h1 className="h1">Settings</h1>
        </div>
        <a className="set-btn" href="/">
          Back to the display
        </a>
      </header>

      <General draft={draft} set={set} />
      <Schedule value={draft.schedule} onChange={(v) => set('schedule', v)} />
      <People value={draft.people} calendars={load.calendars} onChange={(v) => set('people', v)} />
      <Destinations
        value={draft.destinations}
        people={draft.people}
        onChange={(v) => set('destinations', v)}
      />
      <Features value={draft.flags} onChange={(v) => set('flags', v)} />
      <HomeSetupSection people={draft.people} />
      <Displays />

      <footer className="set-bar card" aria-live="polite">
        <span className="set-bar-msg">
          {problem
            ? problem
            : saving === 'saving'
              ? 'Saving…'
              : saving === 'saved'
                ? 'Saved. Displays are reloading with the new settings.'
                : typeof saving === 'object'
                  ? saving.error
                  : dirty
                    ? 'Unsaved changes'
                    : 'All changes saved'}
        </span>
        <button
          className="set-btn"
          disabled={!dirty || saving === 'saving'}
          onClick={() => {
            setDraft(load.saved);
            setSaving('idle');
          }}
        >
          Discard
        </button>
        <button
          className="set-btn primary"
          disabled={!dirty || !!problem || saving === 'saving'}
          onClick={save}
        >
          Save
        </button>
      </footer>
    </Page>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="set-page">
      <main className="set-main">{children}</main>
    </div>
  );
}
