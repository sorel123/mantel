import { useEffect, useState } from 'react';
import { DEFAULT_PANEL } from '@mantel/shared';
import { useBootstrap, useBootstrapState } from '../lib/bootstrap';
import { connectEvents, useConnection } from '../lib/events';
import { useFitScale } from '../lib/fit';
import { useThemeMode } from '../lib/theme';
import { formatClock, useNow } from './Clock';
import { Pairing } from './Pairing';
import { screens, type ScreenId } from './screens';

/**
 * The scaffold's blank shell: loads bootstrap, pairs if needed, fits the panel to the
 * viewport and switches between placeholder screens. WS1 replaces it with the mockup's shell.
 */
export function Shell() {
  const { state, reload } = useBootstrapState();
  const scale = useFitScale(DEFAULT_PANEL.width, DEFAULT_PANEL.height);
  useThemeMode(state.status === 'ready' ? state.data.theme : 'auto');

  let body;
  if (state.status === 'ready') body = <Screens />;
  else if (state.status === 'unpaired')
    body = (
      <Centered>
        <Pairing onPaired={reload} />
      </Centered>
    );
  else if (state.status === 'error')
    body = (
      <Centered>
        <div className="placeholder card">
          <div>
            <h1 className="h2">Can't reach the server</h1>
            <p>{state.message}</p>
            <button className="h2" onClick={reload}>
              Retry
            </button>
          </div>
        </div>
      </Centered>
    );
  else
    body = (
      <Centered>
        <div className="eyebrow">Loading</div>
      </Centered>
    );

  return (
    <div className="stage">
      <div
        className="panel"
        style={{
          width: DEFAULT_PANEL.width,
          height: DEFAULT_PANEL.height,
          transform: `scale(${scale})`,
        }}
      >
        {body}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="screen" style={{ display: 'grid', placeItems: 'center' }}>
      {children}
    </div>
  );
}

function Screens() {
  const boot = useBootstrap();
  const [current, setCurrent] = useState<ScreenId>('today');
  const connection = useConnection();
  const now = useNow();
  useEffect(connectEvents, []);
  const Active = screens.find((s) => s.id === current)!.Component;

  return (
    <>
      <section className="screen" data-screen={current}>
        <div className="status" role="status">
          <span>
            <i className="ok" />
            Server {boot.version}
            {boot.mock ? ' · mock data' : ''}
          </span>
          <span>
            <i className={connection === 'open' ? 'ok' : 'warn'} />
            Live updates {connection}
          </span>
          <span>{boot.people.map((p) => p.name).join(', ')}</span>
        </div>
        <Active />
      </section>
      <nav className="dock" aria-label="Screens">
        {screens.map((s) => (
          <button
            key={s.id}
            aria-current={s.id === current ? 'page' : undefined}
            onClick={() => setCurrent(s.id)}
          >
            <svg viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: s.icon }} />
            {s.label}
          </button>
        ))}
        <span className="clock tnum">{formatClock(now)}</span>
      </nav>
    </>
  );
}
