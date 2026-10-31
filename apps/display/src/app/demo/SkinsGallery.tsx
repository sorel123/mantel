import { ApiRequestError, DEFAULT_APPEARANCE, type Appearance } from '@mantel/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { useBootstrapState } from '../../lib/bootstrap';
import {
  setAppearance,
  setModeOverride,
  setSkinOverride,
  useSkin,
  useThemeMode,
  type Mode,
} from '../../lib/theme';
import { AppearanceSection } from '../../screens/settings/appearance';
import '../../screens/settings/settings.css';
import { Seg } from '../../screens/settings/controls';
import { formatClock, useNow } from '../Clock';
import { Dock } from '../Dock';
import { useMotionPreference } from '../motion';
import { NavProvider } from '../nav';
import { OverlayProvider } from '../overlay';
import { screens, type ScreenId } from '../screens';
import { ScreenSwitcher } from '../ScreenSwitcher';
import { SkinDecor } from '../SkinDecor';
import './gallery.css';

const PANEL = { width: 1180, height: 820 };

/**
 * `/demo/skins`: every skin on the real Today, Month, Lists and Home screens in both looks, with
 * the Appearance controls underneath so accent, font and text size can be tried live. "Use this
 * look on the wall" saves the appearance to settings. `?skin=&mode=&screen=` deep-link a view.
 * Needs the server (mock mode is fine) because the screens load real data.
 */
export default function SkinsGallery() {
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const { state, reload } = useBootstrapState();
  const [mode, setMode] = useState<Mode>(params.get('mode') === 'dusk' ? 'dusk' : 'daylight');
  const [screen, setScreen] = useState<ScreenId>(() => {
    const s = params.get('screen');
    return screens.some((x) => x.id === s) ? (s as ScreenId) : 'today';
  });
  const [draft, setDraft] = useState<Appearance>(() => ({
    ...DEFAULT_APPEARANCE,
    skin: params.get('skin') ?? DEFAULT_APPEARANCE.skin,
  }));
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | string>('idle');
  const bare = params.has('bare');

  useThemeMode(mode);
  useMotionPreference();
  useEffect(() => {
    setModeOverride(mode);
    return () => setModeOverride(null);
  }, [mode]);
  // The gallery drives the theme itself; nothing from bootstrap or the URL pin should.
  useEffect(() => {
    setSkinOverride(null);
    setAppearance(draft);
  }, [draft]);
  useEffect(() => {
    const q = new URLSearchParams({ skin: draft.skin, mode, screen });
    if (bare) q.set('bare', '1');
    history.replaceState(null, '', `${location.pathname}?${q}`);
  }, [draft.skin, mode, screen, bare]);

  const save = async () => {
    setSaving('saving');
    try {
      const current = await api.call('settings');
      await api.call('settingsPut', { body: { ...current, appearance: draft } });
      setSaving('saved');
    } catch (err) {
      setSaving(err instanceof ApiRequestError ? err.message : 'Could not reach the server');
    }
  };

  return (
    <div className={`set-page gal${bare ? ' bare' : ''}`}>
      <main className="set-main gal-main">
        {!bare && (
          <header className="set-head">
            <div>
              <div className="eyebrow">Mantel · gallery</div>
              <h1 className="h1">Skins</h1>
            </div>
            <div className="gal-actions">
              <a className="set-btn" href="/demo">
                Design system
              </a>
              <a className="set-btn" href="/">
                Back to the display
              </a>
            </div>
          </header>
        )}

        {!bare && (
          <div className="gal-controls card">
            <Seg
              label="Look"
              value={mode}
              options={[
                ['daylight', 'Daylight'],
                ['dusk', 'Dusk'],
              ]}
              onChange={setMode}
            />
            <Seg
              label="Screen"
              value={screen}
              options={screens.map((s): [ScreenId, string] => [s.id, s.label])}
              onChange={setScreen}
            />
            <div className="gal-save">
              <span className="set-hint" role="status">
                {saving === 'saving'
                  ? 'Saving…'
                  : saving === 'saved'
                    ? 'Saved. Displays are reloading with this look.'
                    : saving === 'idle'
                      ? ''
                      : saving}
              </span>
              <button
                type="button"
                className="set-btn primary"
                disabled={saving === 'saving' || state.status !== 'ready'}
                onClick={save}
              >
                Use this look on the wall
              </button>
            </div>
          </div>
        )}

        <LivePanel screen={screen} onScreen={setScreen} status={state.status} reload={reload} />

        {!bare && (
          <>
            <AppearanceSection
              value={draft}
              onChange={setDraft}
              mode={mode}
              title="Try the controls"
            />
          </>
        )}
      </main>
    </div>
  );
}

/** The real screens in a 1180×820 panel scaled to the page width. */
function LivePanel({
  screen,
  onScreen,
  status,
  reload,
}: {
  screen: ScreenId;
  onScreen: (id: ScreenId) => void;
  status: 'loading' | 'ready' | 'unpaired' | 'error';
  reload: () => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setScale(Math.min(1, el.clientWidth / PANEL.width));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const { skin, mode } = useSkin();
  const now = useNow();
  const go = useCallback((id: string) => onScreen(id as ScreenId), [onScreen]);
  const nav = useMemo(() => ({ current: screen, go }), [screen, go]);

  return (
    <div
      ref={wrap}
      className="gal-stage"
      style={{ height: PANEL.height * scale }}
      data-skin-shown={skin.id}
      data-mode-shown={mode}
    >
      <div
        className="panel gal-panel"
        style={{ width: PANEL.width, height: PANEL.height, transform: `scale(${scale})` }}
      >
        {status === 'ready' ? (
          <OverlayProvider>
            <NavProvider value={nav}>
              <SkinDecor />
              <ScreenSwitcher screens={screens} current={screen} onChange={go} />
              <Dock items={screens} current={screen} onSelect={go} clock={formatClock(now)} />
            </NavProvider>
          </OverlayProvider>
        ) : (
          <div className="centered">
            <div className="notice card">
              <h2 className="h2">
                {status === 'loading'
                  ? 'Loading the screens'
                  : status === 'unpaired'
                    ? 'Pair this browser first'
                    : "Can't reach the server"}
              </h2>
              <p>
                {status === 'unpaired'
                  ? 'The gallery shows the real screens, so it needs a paired browser. Open the display, pair it, then come back.'
                  : 'The gallery needs the server running; mock mode is fine.'}
              </p>
              {status === 'error' && (
                <button className="btn primary" onClick={reload}>
                  Try again
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
