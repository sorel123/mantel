import { DEFAULT_PANEL, type PanelSize, type ScreenSchedule } from '@mantel/shared';
import { AnimatePresence } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useBootstrap, useBootstrapState } from '../lib/bootstrap';
import { connectEvents, useConnection, useServerEvent } from '../lib/events';
import { useFitPanel } from '../lib/fit';
import { setModeOverride, setSunTimes, useThemeMode } from '../lib/theme';
import { AmbientWeather, useWeather } from '../features/weather';
import { Ambient, ScreenOff, registerAmbientSlot, useIdle } from './ambient';
import { formatClock, useNow } from './Clock';
import { Dock } from './Dock';
import { FeatureLayers } from './FeatureLayers';
import { useMotionPreference } from './motion';
import { NavProvider } from './nav';
import { OverlayProvider, useOverlay } from './overlay';
import { Pairing } from './Pairing';
import { msToNextMinute, scheduleAt, type Phase } from './schedule';
import { screens as allScreens, type ScreenId } from './screens';
import { ScreenSwitcher } from './ScreenSwitcher';

// What Ambient shows beside the clock. Other features (the next event) register their own.
registerAmbientSlot({ id: 'weather', Component: AmbientWeather, order: 0 });

// `?mode=daylight|dusk` pins the look for kiosk tools, screenshots and the smoke test.
const pinned = new URLSearchParams(location.search).get('mode');
if (pinned === 'daylight' || pinned === 'dusk') setModeOverride(pinned);

/**
 * The shell: fits the panel to the viewport, applies the theme, loads bootstrap and pairs if
 * needed, then runs the screens, the dock, overlays, Ambient and the screen schedule.
 */
export function Shell() {
  const { state, reload } = useBootstrapState();
  useThemeMode(state.status === 'ready' ? state.data.theme : 'auto');
  useMotionPreference();

  if (state.status === 'ready') return <Display />;

  let body: ReactNode;
  if (state.status === 'unpaired') body = <Pairing onPaired={reload} />;
  else if (state.status === 'error')
    body = (
      <div className="notice card">
        <h1 className="h2">Can't reach the server</h1>
        <p>{state.message}</p>
        <button className="btn primary" onClick={reload}>
          Try again
        </button>
      </div>
    );
  else
    body = (
      <div className="boot">
        <div className="wordmark">
          Mantel<small>Getting things ready</small>
        </div>
      </div>
    );

  return (
    <Stage panel={DEFAULT_PANEL}>
      <div className="centered">{body}</div>
    </Stage>
  );
}

/**
 * The fixed-size panel, scaled to fit the viewport. Everything positioned "absolute" lives inside
 * it, and the brightness dimmer sits on top of everything.
 */
export function Stage({ panel, children }: { panel: PanelSize; children: ReactNode }) {
  const fit = useFitPanel(panel);
  return (
    <div className="stage">
      <div
        className="panel"
        style={{ width: fit.width, height: fit.height, transform: `scale(${fit.scale})` }}
      >
        {children}
      </div>
      <div className="dimmer" aria-hidden="true" />
    </div>
  );
}

/** Software brightness, 0-100, applied through the dimmer. WS6's kiosk hooks can mirror it to hardware. */
export function setBrightness(level: number) {
  document.documentElement.style.setProperty('--brightness', String(Math.round(level)));
}

export type DisplayMode = 'active' | 'ambient' | 'off';

/**
 * Where the display is in its day. Idle after `idleSeconds` goes to Ambient, or to black during
 * the off window. The minute tick moves Ambient to black at `offFrom` and wakes the screen at
 * `onAt`. Server `display.sleep` and `display.wake` events, and a doorbell, override all of it.
 */
export function useDisplayMode(schedule: ScreenSchedule) {
  const [mode, setMode] = useState<DisplayMode>('active');
  const [waking, setWaking] = useState(false);
  const [{ phase, brightness }, setSchedule] = useState(() => scheduleAt(schedule, new Date()));
  const lastPhase = useRef<Phase>(phase);

  // Re-evaluate the schedule on the minute.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      setSchedule(scheduleAt(schedule, new Date()));
      t = setTimeout(tick, msToNextMinute(new Date()));
    };
    tick();
    return () => clearTimeout(t);
  }, [schedule]);

  // Brightness and the wake flash are CSS, set on <html> so they reach every layer.
  useEffect(() => {
    setBrightness(mode === 'off' ? 100 : brightness);
  }, [brightness, mode]);
  useEffect(() => {
    if (waking) document.documentElement.dataset.waking = '';
    else delete document.documentElement.dataset.waking;
  }, [waking]);

  const wake = useCallback(() => {
    setMode((m) => {
      if (m === 'active') return m;
      setWaking(true);
      setTimeout(() => setWaking(false), 800);
      return 'active';
    });
  }, []);
  const rest = useCallback(() => setMode(phase === 'off' ? 'off' : 'ambient'), [phase]);

  // Phase changes: lights out at offFrom (unless someone is using it), back on at onAt.
  useEffect(() => {
    if (lastPhase.current === phase) return;
    lastPhase.current = phase;
    if (phase === 'off') setMode((m) => (m === 'ambient' ? 'off' : m));
    else if (phase === 'on') setMode((m) => (m === 'off' ? 'active' : m));
  }, [phase]);

  const touch = useIdle(schedule.idleSeconds * 1000, rest, mode === 'active');

  return { mode, phase, brightness, waking, wake, rest, touch, setMode };
}

function Display() {
  const boot = useBootstrap();
  return (
    <Stage panel={boot.panel}>
      <OverlayProvider>
        <DisplayInner />
      </OverlayProvider>
    </Stage>
  );
}

function DisplayInner() {
  const boot = useBootstrap();
  const overlay = useOverlay();
  // WS C: an integration turned off in Settings takes its screen out of the dock (Home for HA).
  const screens = useMemo(
    () =>
      allScreens.filter(
        (s) => s.id !== 'home' || boot.settings.integrations?.homeassistant?.enabled !== false,
      ),
    [boot.settings.integrations],
  );
  const now = useNow();
  const [current, setCurrent] = useState<ScreenId>('today');
  const { mode, wake, rest, setMode } = useDisplayMode(boot.settings.schedule);
  const connection = useConnection();
  useEffect(connectEvents, []);

  // Auto theme follows today's sunrise and sunset once the weather is in.
  const weather = useWeather().data;
  useEffect(() => {
    setSunTimes(weather ? { sunrise: weather.sunrise, sunset: weather.sunset } : null);
  }, [weather]);

  // Server-driven sleep and wake; a doorbell always lights the screen so the pop-over is seen.
  useServerEvent('display.sleep', rest);
  useServerEvent('display.wake', wake);
  useServerEvent('home.doorbell', wake);

  // Ambient and the black screen take the whole panel; nothing stays open under them.
  const closeAll = overlay.closeAll;
  useEffect(() => {
    if (mode !== 'active') closeAll();
  }, [mode, closeAll]);

  const go = useCallback(
    (id: string) => {
      closeAll();
      setCurrent(id as ScreenId);
    },
    [closeAll],
  );
  const nav = useMemo(() => ({ current, go }), [current, go]);
  const wakeToToday = () => {
    setCurrent('today');
    wake();
  };

  // The quiet way into setup from the wall: hold the dock clock for a second.
  const openSettings = async () => {
    const ok = await overlay.confirm({
      title: 'Open settings?',
      body: 'Schedule, people, places and features. The display comes back when you are done.',
      confirmLabel: 'Open settings',
      cancelLabel: 'Stay here',
    });
    if (ok) location.assign('/settings');
  };

  return (
    <NavProvider value={nav}>
      <ScreenSwitcher screens={screens} current={current} onChange={go} />
      <Dock
        items={screens}
        current={current}
        onSelect={go}
        clock={formatClock(now)}
        onClockHold={openSettings}
        onAmbient={() => setMode('ambient')}
      />
      <div className="status">
        {boot.mock && (
          <span className="chip neutral">
            <i />
            Mock data
          </span>
        )}
        {connection === 'closed' && (
          <span className="chip offline">
            <i />
            Offline
          </span>
        )}
      </div>
      <FeatureLayers />
      <AnimatePresence>
        {mode === 'ambient' && <Ambient key="ambient" onWake={wakeToToday} />}
        {mode === 'off' && <ScreenOff key="off" onWake={wake} />}
      </AnimatePresence>
    </NavProvider>
  );
}
