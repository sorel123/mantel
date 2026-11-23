/**
 * The companion app at `/app` (and the old `/add`): the family's remote on a phone, installable
 * from the home screen. Bottom tabs: Lists, Calendar, Inbox, Meals, Chores, Note. The tab lives in the
 * URL hash so a notification can open the right one. A phone pairs once with the admin PIN.
 */
import { deepLinkUrl, parseDeepLink } from '@mantel/shared';
import { useEffect, useState } from 'react';
import { SinceStrip, useSince } from '../../features/digest';
import { DigestPage, useDeepFocus } from './digest';
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
import { InboxTab } from './inbox/InboxTab';
import { registerShareWorker } from './inbox/share';
import { useInbox } from '../../features/inbox';
import '../lists/lists.css';
import '../today/calendar.css';
import './companion.css';

export type Tab = 'lists' | 'calendar' | 'inbox' | 'meals' | 'chores' | 'note' | 'digest';
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
    id: 'inbox',
    label: 'Inbox',
    icon: <path d="M3 13h5l1.5 3h5L16 13h5M5.5 5h13L21 13v6H3v-6z" />,
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
// v4 D: the digest page has no tab-bar button; the sun at the top and notifications open it.
const TAB_IDS = new Set<string>([...TABS.map((t) => t.id), 'digest']);

/** The tab and, for a deep link (`#chores/chore-1`), the item to open on it. */
function fromHash(): { tab: Tab; id?: string } {
  const link = parseDeepLink(location.hash);
  if (!link || !TAB_IDS.has(link.tab)) return { tab: 'lists' };
  return { tab: link.tab as Tab, ...(link.id ? { id: link.id } : {}) };
}

export function useTab(): [Tab, (t: Tab) => void, string | undefined] {
  const [at, setAt] = useState(fromHash);
  useEffect(() => {
    const onHash = () => setAt(fromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return [
    at.tab,
    (t) => {
      if (location.hash !== `#${t}`) history.replaceState(null, '', `#${t}`);
      setAt({ tab: t });
      window.scrollTo({ top: 0 });
    },
    at.id,
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
  const [tab, go, deepId] = useTab();
  useDeepFocus(tab === 'digest' ? undefined : deepId);
  const sinceOn =
    boot.settings.sinceStrip !== false && boot.settings.integrations.digest?.enabled !== false;
  const since = useSince('phone', sinceOn);
  const [settings, setSettings] = useState(false);
  const [hint, setHint] = useState(
    () => !isStandalone() && localStorage.getItem(INSTALL_HINT_KEY) !== 'seen',
  );
  useEffect(connectEvents, []);
  useEffect(registerShareWorker, []);
  const { pending } = useInbox();
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
          className="ax ctop-day"
          aria-label="Your day"
          aria-current={tab === 'digest' ? 'page' : undefined}
          onClick={() => go('digest')}
        >
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z" />
          </svg>
        </button>
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

      {sinceOn && tab !== 'digest' && (
        <SinceStrip
          since={since}
          people={boot.people}
          variant="phone"
          autoClearMs={60_000}
          onOpen={(link) => {
            location.hash = deepLinkUrl(link).slice('/app'.length);
          }}
        />
      )}

      <div className="ctab" key={`${tab}:${deepId ?? ''}`}>
        {tab === 'digest' && <DigestPage id={deepId} people={boot.people} />}
        {tab === 'lists' && <AddItems people={boot.people} />}
        {tab === 'calendar' && <CalendarTab />}
        {tab === 'inbox' && <InboxTab />}
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
              {t.id === 'inbox' && pending > 0 && (
                <span className="ctab-badge" aria-label={`${pending} waiting`}>
                  {pending}
                </span>
              )}
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
