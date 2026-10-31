import { DEFAULT_PANEL, type PanelSize, type ScreenSchedule } from '@mantel/shared';
import { AnimatePresence } from 'framer-motion';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useBootstrap, useBootstrapState } from '../lib/bootstrap';
import { connectEvents, useConnection, useServerEvent } from '../lib/events';
import { useFitPanel } from '../lib/fit';
import { useThemeMode } from '../lib/theme';
import { Ambient, ScreenOff, useIdle } from './ambient';
import { formatClock, useNow } from './Clock';
import { Dock } from './Dock';
import { FeatureLayers } from './FeatureLayers';
import { useMotionPreference } from './motion';
import { OverlayProvider, useOverlay } from './overlay';
import { Pairing } from './Pairing';
import { msToNextMinute, scheduleAt, type Phase } from './schedule';
import { screens, type ScreenId } from './screens';
import { ScreenSwitcher } from './ScreenSwitcher';

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
  const now = useNow();
  const [current, setCurrent] = useState<ScreenId>('today');
  const { mode, wake, rest, setMode } = useDisplayMode(boot.settings.schedule);
  const connection = useConnection();
  useEffect(connectEvents, []);

  // Server-driven sleep and wake; a doorbell always lights the screen so the pop-over is seen.
  useServerEvent('display.sleep', rest);
  useServerEvent('display.wake', wake);
  useServerEvent('home.doorbell', wake);

  // Ambient and the black screen take the whole panel; nothing stays open under them.
  const closeAll = overlay.closeAll;
  useEffect(() => {
    if (mode !== 'active') closeAll();
  }, [mode, closeAll]);

  const go = (id: string) => {
    closeAll();
    setCurrent(id as ScreenId);
  };
  const wakeToToday = () => {
    setCurrent('today');
    wake();
  };

  return (
    <>
      <ScreenSwitcher screens={screens} current={current} onChange={go} />
      <Dock
        items={screens}
        current={current}
        onSelect={go}
        clock={formatClock(now)}
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
    </>
  );
}
