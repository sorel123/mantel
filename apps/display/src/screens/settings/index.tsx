import {
  ApiRequestError,
  Settings,
  type Calendar,
  type IntegrationStatus,
  type PluginManifest,
} from '@mantel/shared';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pairing } from '../../app/Pairing';
import { api } from '../../lib/api';
import { useThemeMode } from '../../lib/theme';
import { BackupSection } from './Backup';
import { CalendarsSection } from './Calendars';
import { errorText } from './client';
import type { SectionId } from './contract';
import { Displays } from './Displays';
import { AppearanceFallback, LayoutFallback } from './Fallbacks';
import { HealthSection } from './Health';
import { HelpSection } from './Help';
import { HomeSection } from './Home';
import { AdvancedSection, IntegrationCard, IntegrationsSection } from './Integrations';
import { ListsSection } from './ListsAdmin';
import { AppearanceSection, HomeSetupSection, LayoutSection, Mount } from './Optional';
import { ScreensSection } from './Screens';
import { Destinations, Features, People, Schedule } from './sections';
import { Section } from './controls';
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

/** The left nav, in groups. Ids double as URL hashes (`/settings#calendars`). */
export const NAV: Array<{ group: string; items: Array<{ id: SectionId; label: string }> }> = [
  {
    group: 'Set up',
    items: [
      { id: 'home', label: 'Your home' },
      { id: 'people', label: 'People' },
      { id: 'calendars', label: 'Calendars' },
      { id: 'homeassistant', label: 'Home Assistant' },
      { id: 'integrations', label: 'Integrations' },
    ],
  },
  {
    group: 'Look',
    items: [
      { id: 'appearance', label: 'Appearance' },
      { id: 'layout', label: 'Layout' },
      { id: 'screens', label: 'Screens and dock' },
    ],
  },
  {
    group: 'Household',
    items: [
      { id: 'lists', label: 'Lists and chores' },
      { id: 'places', label: 'Leave-by places' },
      { id: 'schedule', label: 'Screen schedule' },
      { id: 'features', label: 'Features' },
    ],
  },
  {
    group: 'System',
    items: [
      { id: 'displays', label: 'Displays' },
      { id: 'health', label: 'Health' },
      { id: 'backup', label: 'Backup' },
      { id: 'help', label: 'Help' },
      { id: 'advanced', label: 'Advanced' },
    ],
  },
];
const SECTION_IDS = new Set<string>(NAV.flatMap((g) => g.items.map((i) => i.id)));

function sectionFromHash(): SectionId {
  const id = location.hash.replace(/^#/, '').split('?')[0] ?? '';
  return (SECTION_IDS.has(id) ? id : 'home') as SectionId;
}

/** Keeps the current section in the URL hash, so links like `/settings#calendars` work. */
export function useSection(): [SectionId, (id: SectionId) => void] {
  const [section, setSection] = useState<SectionId>(sectionFromHash);
  useEffect(() => {
    const onHash = () => setSection(sectionFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const go = useCallback((id: SectionId) => {
    if (location.hash !== `#${id}`) location.hash = id;
    setSection(id);
    window.scrollTo({ top: 0 });
  }, []);
  return [section, go];
}

/** Plugin manifests and statuses, loaded once and patched as cards save. */
export function useIntegrations() {
  const [plugins, setPlugins] = useState<PluginManifest[]>([]);
  const [statuses, setStatuses] = useState<Record<string, IntegrationStatus>>({});
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    Promise.all([api.call('plugins'), api.call('integrations')])
      .then(([p, i]) => {
        setPlugins(p.plugins);
        setStatuses(Object.fromEntries(i.integrations.map((s) => [s.id, s])));
        setError(null);
      })
      .catch((err: unknown) => {
        // A server without workstream A's routes yet: the page still works for the rest.
        if (err instanceof ApiRequestError && [404, 501].includes(err.status)) setError(null);
        else setError(errorText(err));
      });
  }, []);
  useEffect(load, [load]);
  const onStatus = useCallback(
    (s: IntegrationStatus) => setStatuses((all) => ({ ...all, [s.id]: s })),
    [],
  );
  return { plugins, statuses, onStatus, reload: load, error };
}

/**
 * The hub at `/settings`: every setting, credential and integration in one place, in sections a
 * left nav switches between. A normal scrolling page, so it works from a phone or laptop as
 * well as the wall. Saving tells every display to reload so the new settings apply at once.
 */
export function SettingsPage() {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [draft, setDraft] = useState<Settings | null>(null);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | { error: string }>('idle');
  const [section, go] = useSection();
  const integrations = useIntegrations();

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

  // A fresh install goes to the wizard instead; it comes back here when it is done.
  useEffect(() => {
    if (load.status !== 'unpaired') return;
    api
      .call('setupState')
      .then((s) => {
        if (s.firstRun && !s.completed) location.replace('/setup');
      })
      .catch(() => undefined);
  }, [load.status]);

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
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  };

  const all = Object.values(integrations.statuses);
  const attention = all.filter((s) => s.enabled && s.state === 'error');
  const connected = all.filter((s) => s.enabled && s.state === 'connected').length;
  const ha = integrations.plugins.find((p) => p.id === 'homeassistant');

  const body: Record<SectionId, () => ReactNode> = {
    home: () => <HomeSection draft={draft} set={set} />,
    people: () => (
      <People value={draft.people} calendars={load.calendars} onChange={(v) => set('people', v)} />
    ),
    calendars: () => (
      <CalendarsSection
        plugins={integrations.plugins}
        statuses={integrations.statuses}
        onStatus={integrations.onStatus}
      />
    ),
    integrations: () => (
      <IntegrationsSection
        plugins={integrations.plugins}
        statuses={integrations.statuses}
        onStatus={integrations.onStatus}
        exclude={['google', 'icloud', 'ical', 'homeassistant']}
      />
    ),
    homeassistant: () => (
      <Mount
        Component={HomeSetupSection}
        props={{
          plugin: ha,
          status: integrations.statuses.homeassistant,
          onStatus: integrations.onStatus,
        }}
        fallback={
          <Section
            id="homeassistant"
            title="Home Assistant"
            hint="Connect with the address and a token. The room-by-room picker arrives with the Home Assistant update; until then the allow-list file applies."
          >
            {ha ? (
              <IntegrationCard
                manifest={ha}
                status={integrations.statuses.homeassistant}
                onStatus={integrations.onStatus}
              />
            ) : (
              <p className="set-hint">The server has not reported Home Assistant yet.</p>
            )}
          </Section>
        }
      />
    ),
    appearance: () => (
      <Mount
        Component={AppearanceSection}
        props={{
          value: draft.appearance,
          onChange: (v: Settings['appearance']) => set('appearance', v),
          draft,
          set,
        }}
        fallback={
          <AppearanceFallback
            value={draft.appearance}
            theme={draft.theme}
            onChange={(v) => set('appearance', v)}
            onTheme={(t) => set('theme', t)}
          />
        }
      />
    ),
    layout: () => (
      <Mount
        Component={LayoutSection}
        props={{
          value: draft.layout,
          onChange: (v: Settings['layout']) => set('layout', v),
          draft,
          set,
        }}
        fallback={<LayoutFallback value={draft.layout} onChange={(v) => set('layout', v)} />}
      />
    ),
    screens: () => (
      <ScreensSection
        screens={draft.screens}
        defaultScreen={draft.defaultScreen}
        onChange={(screens, defaultScreen) => {
          setSaving('idle');
          setDraft((d) => (d ? { ...d, screens, defaultScreen } : d));
        }}
      />
    ),
    lists: () => <ListsSection people={draft.people} />,
    places: () => (
      <Destinations
        value={draft.destinations}
        people={draft.people}
        onChange={(v) => set('destinations', v)}
      />
    ),
    schedule: () => <Schedule value={draft.schedule} onChange={(v) => set('schedule', v)} />,
    features: () => <Features value={draft.flags} onChange={(v) => set('flags', v)} />,
    displays: () => <Displays screens={draft.screens} />,
    health: () => <HealthSection version={load.version} mock={load.mock} />,
    backup: () => <BackupSection />,
    help: () => <HelpSection />,
    advanced: () => (
      <AdvancedSection
        plugins={integrations.plugins}
        statuses={integrations.statuses}
        onStatus={integrations.onStatus}
      />
    ),
  };

  return (
    <Page
      nav={
        <nav className="set-nav" aria-label="Settings sections">
          {NAV.map((g) => (
            <div className="set-nav-group" key={g.group}>
              <div className="eyebrow">{g.group}</div>
              {g.items.map((item) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  aria-current={section === item.id ? 'page' : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    go(item.id);
                  }}
                >
                  {item.label}
                  {item.id === 'integrations' && attention.length > 0 && (
                    <span
                      className="set-nav-dot"
                      aria-label={`${attention.length} need attention`}
                    />
                  )}
                </a>
              ))}
            </div>
          ))}
        </nav>
      }
    >
      <header className="set-head">
        <div>
          <div className="eyebrow">
            Mantel {load.version}
            {load.mock ? ' · mock data' : ''}
            {all.length > 0 && (
              <>
                {' · '}
                {connected} connected
                {attention.length > 0 && (
                  <>
                    {' · '}
                    <button
                      type="button"
                      className="set-linkbtn warn"
                      onClick={() => go('integrations')}
                    >
                      {attention.length} need{attention.length === 1 ? 's' : ''} attention
                    </button>
                  </>
                )}
              </>
            )}
          </div>
          <h1 className="h1">Settings</h1>
        </div>
        <span className="set-pair">
          <a className="set-btn quiet" href="/setup">
            Setup wizard
          </a>
          <a className="set-btn" href="/">
            Back to the display
          </a>
        </span>
      </header>

      {integrations.error && <p className="set-err">{integrations.error}</p>}
      <div key={section} className="set-section-anim">
        {body[section]()}
      </div>

      {(dirty || saving !== 'idle' || problem) && (
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
      )}
    </Page>
  );
}

function Page({ nav, children }: { nav?: ReactNode; children: ReactNode }) {
  return (
    <div className="set-page">
      <div className={`set-shell${nav ? ' with-nav' : ''}`}>
        {nav}
        <main className="set-main">{children}</main>
      </div>
    </div>
  );
}
