/**
 * The companion app at `/app` (and the old `/add`): the family's remote on a phone, installable
 * from the home screen. Bottom tabs: Lists, Calendar, Meals, Chores, Note. The tab lives in the
 * URL hash so a notification can open the right one. A phone pairs once with the admin PIN.
 */
import { useEffect, useState } from 'react';
import { OverlayProvider } from '../../app/overlay';
import { Pairing } from '../../app/Pairing';
import { useBootstrap, useBootstrapState } from '../../lib/bootstrap';
import { connectEvents } from '../../lib/events';
import { useAppearance, useSkin, useThemeMode } from '../../lib/theme';
import { AddItems } from './ListsTab';
import { NotificationsSheet } from './Notifications';
import { CalendarTab } from './tabs/CalendarTab';
import { ChoresTab } from './tabs/ChoresTab';
import { MealsTab } from './tabs/MealsTab';
import { NoteTab } from './tabs/NoteTab';
import '../lists/lists.css';
import '../today/calendar.css';
import './companion.css';

export type Tab = 'lists' | 'calendar' | 'meals' | 'chores' | 'note';
const TABS: Array<{ id: Tab; label: string; icon: JSX.Element }> = [
  {
    id: 'lists',
    label: 'Lists',
    icon: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  },
  {
    id: 'calendar',
    label: 'Calendar',
    icon: <path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" />,
  },
  {
    id: 'meals',
    label: 'Meals',
    icon: <path d="M7 3v8a2 2 0 0 0 2 2v8M11 3v6M7 7h4M17 3c-1.7 1-3 3.2-3 6v4h3v8" />,
  },
  {
    id: 'chores',
    label: 'Chores',
    icon: <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />,
  },
  { id: 'note', label: 'Note', icon: <path d="M5 4h14v11l-5 5H5zM14 20v-5h5M8 9h8M8 13h5" /> },
];
const TAB_IDS = new Set<string>(TABS.map((t) => t.id));

function tabFromHash(): Tab {
  const id = location.hash.replace(/^#/, '');
  return (TAB_IDS.has(id) ? id : 'lists') as Tab;
}

export function useTab(): [Tab, (t: Tab) => void] {
  const [tab, setTab] = useState<Tab>(tabFromHash);
  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return [
    tab,
    (t) => {
      if (location.hash !== `#${t}`) history.replaceState(null, '', `#${t}`);
      setTab(t);
      window.scrollTo({ top: 0 });
    },
  ];
}

const INSTALL_HINT_KEY = 'mantel.companion.installHint';
const isStandalone = () =>
  (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) ||
  (navigator as unknown as { standalone?: boolean }).standalone === true;

export function CompanionApp() {
  const { state, reload } = useBootstrapState();
  useThemeMode(state.status === 'ready' ? state.data.theme : 'auto');
  useAppearance(state.status === 'ready' ? state.data.settings.appearance : undefined);
  useEffect(() => {
    document.body.classList.add('phone');
    return () => document.body.classList.remove('phone');
  }, []);

  if (state.status === 'ready')
    return (
      <OverlayProvider>
        <Ready />
      </OverlayProvider>
    );
  return (
    <main className="addpage">
      {state.status === 'unpaired' ? (
        <Pairing onPaired={reload} />
      ) : state.status === 'error' ? (
        <div className="card apanel">
          <h1 className="h2">Can't reach Mantel</h1>
          <p className="amuted">{state.message}</p>
          <button className="abtn" onClick={reload}>
            Retry
          </button>
        </div>
      ) : (
        <div className="amuted">Loading</div>
      )}
    </main>
  );
}

function Ready() {
  const boot = useBootstrap();
  const [tab, go] = useTab();
  const [settings, setSettings] = useState(false);
  const [hint, setHint] = useState(
    () => !isStandalone() && localStorage.getItem(INSTALL_HINT_KEY) !== 'seen',
  );
  useEffect(connectEvents, []);
  useThemeColor();

  const dismissHint = () => {
    localStorage.setItem(INSTALL_HINT_KEY, 'seen');
    setHint(false);
  };

  return (
    <main className="addpage companion">
      <header className="ctop">
        <span className="eyebrow">Mantel</span>
        <button
          type="button"
          className="ax"
          aria-label="Notifications and this phone"
          onClick={() => setSettings(true)}
        >
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M12 3a5 5 0 0 0-5 5v3.5L5 15v1h14v-1l-2-3.5V8a5 5 0 0 0-5-5zM10 19a2 2 0 0 0 4 0" />
          </svg>
        </button>
      </header>

      {hint && (
        <aside className="card apanel install-hint" aria-label="Add to home screen">
          <b>Keep Mantel on your home screen</b>
          <p className="amuted">
            {/iP(hone|ad)/.test(navigator.userAgent)
              ? 'Tap Share, then "Add to Home Screen". It opens full screen and can show notifications.'
              : 'Open the browser menu and choose "Add to Home screen" or "Install app".'}
          </p>
          <button type="button" className="alink neutral" onClick={dismissHint}>
            Got it
          </button>
        </aside>
      )}

      <div className="ctab" key={tab}>
        {tab === 'lists' && <AddItems people={boot.people} />}
        {tab === 'calendar' && <CalendarTab />}
        {tab === 'meals' && <MealsTab />}
        {tab === 'chores' && <ChoresTab people={boot.people} />}
        {tab === 'note' && <NoteTab />}
      </div>

      <nav className="ctabbar" aria-label="Companion tabs">
        {TABS.filter((t) => t.id !== 'chores' || boot.flags.chores)
          .filter((t) => t.id !== 'meals' || boot.flags.meals)
          .map((t) => (
            <button
              key={t.id}
              type="button"
              aria-current={tab === t.id ? 'page' : undefined}
              onClick={() => go(t.id)}
            >
              <svg viewBox="0 0 24 24" aria-hidden>
                {t.icon}
              </svg>
              {t.label}
            </button>
          ))}
      </nav>

      {settings && <NotificationsSheet onClose={() => setSettings(false)} />}
    </main>
  );
}

/** Keep the browser chrome (and the installed app's title bar) in the skin's background colour. */
function useThemeColor() {
  const { skin, mode } = useSkin();
  useEffect(() => {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    if (bg) meta.content = bg;
  }, [skin, mode]);
}
