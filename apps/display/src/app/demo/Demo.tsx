import { DEFAULT_PANEL, type ThemeMode } from '@mantel/shared';
import { settings as settingsFixture } from '@mantel/shared/fixtures';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { setModeOverride, useThemeMode } from '../../lib/theme';
import '../../styles/demo.css';
import { Ambient, ScreenOff, placeholderPhotos } from '../ambient';
import { formatClock, useNow } from '../Clock';
import { Dock } from '../Dock';
import { EASE, FAST, SLOW, STD, useMotionPreference } from '../motion';
import { OverlayProvider, PopoverHeader, SheetHeader, useOverlay } from '../overlay';
import { brightnessAt, minutesOf, phaseAt } from '../schedule';
import { ScreenSwitcher } from '../ScreenSwitcher';
import { setBrightness, Stage } from '../Shell';

/**
 * The design-system gallery at /demo: every token, primitive and overlay, Ambient, screen off and
 * the schedule, with no server. Open it at http://localhost:5173/demo.
 */
export default function Demo() {
  const [theme, setTheme] = useState<ThemeMode>('daylight');
  useThemeMode(theme);
  useMotionPreference();
  useEffect(() => () => setModeOverride(null), []);
  return (
    <Stage panel={DEFAULT_PANEL}>
      <OverlayProvider>
        <DemoInner theme={theme} setTheme={setTheme} />
      </OverlayProvider>
    </Stage>
  );
}

const sections = [
  {
    id: 'tokens',
    label: 'Tokens',
    icon: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z"/>',
    Component: TokensSection,
  },
  {
    id: 'components',
    label: 'Components',
    icon: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/>',
    Component: ComponentsSection,
  },
  {
    id: 'overlays',
    label: 'Overlays',
    icon: '<rect x="3" y="3" width="18" height="18" rx="4"/><rect x="8" y="8" width="13" height="13" rx="3"/>',
    Component: OverlaysSection,
  },
  {
    id: 'schedule',
    label: 'Schedule',
    icon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
    Component: ScheduleSection,
  },
];

type Preview = 'none' | 'ambient' | 'off';

function DemoInner({ theme, setTheme }: { theme: ThemeMode; setTheme: (t: ThemeMode) => void }) {
  const now = useNow();
  const [current, setCurrent] = useState('tokens');
  const [preview, setPreview] = useState<Preview>('none');
  const photos = useMemo(() => placeholderPhotos(), []);
  const screens = useMemo(
    () =>
      sections.map((s) => ({
        id: s.id,
        Component: () => (
          <DemoFrame theme={theme} setTheme={setTheme} setPreview={setPreview} title={s.label}>
            <s.Component setPreview={setPreview} />
          </DemoFrame>
        ),
      })),
    [theme, setTheme],
  );
  return (
    <>
      <ScreenSwitcher screens={screens} current={current} onChange={setCurrent} />
      <Dock
        items={sections}
        current={current}
        onSelect={setCurrent}
        clock={formatClock(now)}
        onAmbient={() => setPreview('ambient')}
      />
      <AnimatePresence>
        {preview === 'ambient' && (
          <Ambient
            key="ambient"
            photos={photos}
            onWake={() => setPreview('none')}
            aside={
              <>
                <div className="w">
                  <svg viewBox="0 0 24 24">
                    <path d="M7 16a4 4 0 0 1 .7-7.9A5 5 0 0 1 17.3 10 3.5 3.5 0 0 1 17 17H7z" />
                  </svg>
                  <b className="tnum">54°</b>
                  <span>Partly cloudy</span>
                </div>
                <div className="nx">
                  Next · 9:00 am<b>Team standup</b>
                </div>
              </>
            }
          />
        )}
        {preview === 'off' && <ScreenOff key="off" onWake={() => setPreview('none')} />}
      </AnimatePresence>
    </>
  );
}

function DemoFrame({
  title,
  theme,
  setTheme,
  children,
}: {
  title: string;
  theme: ThemeMode;
  setTheme: (t: ThemeMode) => void;
  setPreview: (p: Preview) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="demo">
      <div className="demo-head">
        <div className="title">
          Mantel<span>{title}</span>
        </div>
        <div className="seg" role="group" aria-label="Theme">
          {(['daylight', 'dusk', 'auto'] as ThemeMode[]).map((t) => (
            <button key={t} className="btn" aria-pressed={theme === t} onClick={() => setTheme(t)}>
              {t === 'daylight' ? 'Daylight' : t === 'dusk' ? 'Dusk' : 'Auto'}
            </button>
          ))}
        </div>
      </div>
      <div className="demo-body">{children}</div>
    </div>
  );
}

/* ---------- Tokens ---------- */

const swatches = [
  ['bg', 'Background'],
  ['surface', 'Surface'],
  ['surface-2', 'Surface 2'],
  ['ink', 'Ink'],
  ['ink-2', 'Ink 2'],
  ['ink-3', 'Ink 3'],
  ['accent', 'Accent'],
  ['accent-soft', 'Accent soft'],
  ['warn', 'Warn'],
  ['good', 'Good'],
  ['line', 'Line'],
  ['scrim', 'Scrim'],
];
const people = [
  ['jay', 'Jay'],
  ['sam', 'Sam'],
  ['ava', 'Ava'],
  ['leo', 'Leo'],
];

function TokensSection() {
  const [playing, setPlaying] = useState(false);
  return (
    <>
      <div className="card span">
        <div className="head">
          <h2 className="h2">Colour</h2>
          <span className="n">
            Daylight and Dusk, set on &lt;html data-mode&gt;; 700 ms cross-fade
          </span>
        </div>
        <div className="swatches">
          {swatches.map(([v, label]) => (
            <div className="swatch" key={v}>
              <i style={{ '--sw': `var(--${v})` } as CSSProperties} />
              <b>{label}</b>
              <span>--{v}</span>
            </div>
          ))}
        </div>
        <div className="swatches">
          {people.map(([id, name]) => (
            <div className="swatch" key={id}>
              <i style={{ '--sw': `var(--p-${id})` } as CSSProperties} />
              <b>{name}</b>
              <span>--p-{id}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="head">
          <h2 className="h2">Type</h2>
          <span className="n">Fraunces for display, Manrope for everything else</span>
        </div>
        <div className="type-row">
          <span className="eyebrow">display-xl</span>
          <span className="display-xl tnum" style={{ fontSize: 96 }}>
            31
          </span>
          <span className="italic-note">Friday</span>
        </div>
        <div className="type-row">
          <span className="eyebrow">h1</span>
          <span className="h1">October</span>
        </div>
        <div className="type-row">
          <span className="eyebrow">h2</span>
          <span className="h2">Today</span>
        </div>
        <div className="type-row">
          <span className="eyebrow">h3</span>
          <span className="h3">Grocery</span>
        </div>
        <div className="type-row">
          <span className="eyebrow">eyebrow</span>
          <span className="eyebrow">Workstream 2 · Calendars</span>
        </div>
        <div className="type-row">
          <span className="eyebrow">body</span>
          <span>Soccer practice at Riverside field, 3:30 to 5 pm.</span>
          <span className="muted">Secondary</span>
          <span className="faint">Tertiary</span>
        </div>
      </div>
      <div className="card">
        <div className="head">
          <h2 className="h2">Motion</h2>
          <span className="n">One curve, three durations</span>
        </div>
        <div className="bars">
          {[
            ['--fast 150 ms', FAST, 'toggles and checks'],
            ['--std 320 ms', STD, 'screens, sheets, paging'],
            ['--slow 700 ms', SLOW, 'ambient, theme'],
          ].map(([label, d, use]) => (
            <div className="bar-row" key={label as string}>
              <div>
                <div style={{ fontWeight: 600 }}>{label}</div>
                <div className="small muted">{use}</div>
              </div>
              <div className="bar-track">
                <motion.i
                  className="bar-knob"
                  animate={{ x: playing ? 'calc(100% - 30px)' : 0 }}
                  style={{ display: 'block', width: 24 }}
                  transition={{ duration: d as number, ease: EASE }}
                />
              </div>
            </div>
          ))}
        </div>
        <div className="wrap">
          <button className="btn primary" onClick={() => setPlaying((p) => !p)}>
            Play
          </button>
          <span className="small muted">
            Reduced motion collapses all three to 0 ms (data-motion="reduced").
          </span>
        </div>
        <div className="head">
          <h2 className="h2">Spacing and shape</h2>
        </div>
        <div className="wrap small muted">
          <span className="chip neutral">--tap 56 px</span>
          <span className="chip neutral">--radius-card 20</span>
          <span className="chip neutral">--radius-lg 16</span>
          <span className="chip neutral">--radius-md 12</span>
          <span className="chip neutral">--gap 20</span>
          <span className="chip neutral">--screen-x 36</span>
        </div>
      </div>
    </>
  );
}

/* ---------- Components ---------- */

function ComponentsSection() {
  const [on, setOn] = useState(true);
  const [checked, setChecked] = useState([true, false, false]);
  const [level, setLevel] = useState(70);
  const [seg, setSeg] = useState('Week');
  return (
    <>
      <div className="card">
        <h2 className="h2">Buttons</h2>
        <div className="wrap">
          <button className="btn primary">Quick add</button>
          <button className="btn">Keep locked</button>
          <button className="btn danger">Unlock</button>
          <button className="btn ghost">Today</button>
          <button className="btn quiet">Skip</button>
          <button className="btn selected">Morning</button>
          <button className="btn" disabled>
            Disabled
          </button>
        </div>
        <div className="wrap">
          <button className="btn icon" aria-label="Previous">
            <svg viewBox="0 0 24 24">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
          <button className="btn icon" aria-label="Next">
            <svg viewBox="0 0 24 24">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
          <button className="btn icon primary" aria-label="Add">
            <svg viewBox="0 0 24 24">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <button className="btn sm">Small</button>
          <button className="btn lg primary">Large</button>
          <div className="seg" role="group" aria-label="Range">
            {['Day', 'Week', 'Month'].map((s) => (
              <button key={s} className="btn" aria-pressed={seg === s} onClick={() => setSeg(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="card">
        <h2 className="h2">Controls</h2>
        <div className="kv">
          <div>
            <span>Switch</span>
            <span className="sw-hit">
              <button
                className="sw"
                role="switch"
                aria-checked={on}
                aria-label="Ceiling"
                onClick={() => setOn((v) => !v)}
              />
            </span>
          </div>
          <div>
            <span>Range (--v fill)</span>
            <input
              className="range"
              type="range"
              min={1}
              max={100}
              value={level}
              aria-label="Brightness"
              style={{ '--v': `${level}%`, width: 220 } as CSSProperties}
              onChange={(e) => setLevel(+e.target.value)}
            />
          </div>
        </div>
        <ul className="stack" style={{ gap: 2 }}>
          {['Oat milk', 'Bananas', 'Birthday candles'].map((t, i) => (
            <li key={t}>
              <button
                className="row"
                style={{ minHeight: 52, width: '100%', padding: '4px 6px', fontSize: 16 }}
                onClick={() => setChecked((c) => c.map((v, j) => (j === i ? !v : v)))}
              >
                <span className={`cb${checked[i] ? ' on' : ''}`}>
                  <svg viewBox="0 0 24 24">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                </span>
                <span className={checked[i] ? 'muted' : ''}>{t}</span>
              </button>
            </li>
          ))}
        </ul>
        <input className="input" placeholder="Add to grocery" aria-label="Add to grocery" />
      </div>
      <div className="card">
        <h2 className="h2">People</h2>
        <div className="wrap">
          <div className="avs">
            {people.map(([id, n]) => (
              <span key={id} className="av" style={{ '--pc': `var(--p-${id})` } as CSSProperties}>
                {n?.[0]}
              </span>
            ))}
          </div>
          <div className="avs">
            {people.map(([id, n]) => (
              <span
                key={id}
                className="av sm"
                style={{ '--pc': `var(--p-${id})` } as CSSProperties}
              >
                {n?.[0]}
              </span>
            ))}
          </div>
          <span className="av lg" style={{ '--pc': 'var(--p-ava)' } as CSSProperties}>
            A
          </span>
          <span className="av away" style={{ '--pc': 'var(--p-sam)' } as CSSProperties}>
            S
          </span>
          <span className="small muted">away</span>
        </div>
        <div className="wrap">
          <span className="band" style={{ '--pc': 'var(--p-ava)' } as CSSProperties}>
            <i />
            Picture day
          </span>
          <span className="pill" style={{ '--pc': 'var(--p-leo)' } as CSSProperties}>
            <span className="tnum">3:30pm</span> Soccer practice
          </span>
          <span className="chip">Leave by 7:35</span>
          <span className="chip neutral">4 left</span>
        </div>
      </div>
      <div className="card">
        <h2 className="h2">Rows and states</h2>
        <div className="kv">
          <div>
            <span>
              <i className="dot" />
              Garage
            </span>
            Closed
          </div>
          <div>
            <span>
              <i className="dot warn" />
              Back door
            </span>
            Open 12 min
          </div>
          <div>
            <span>
              <i className="dot off" />
              Sprinklers
            </span>
            Off
          </div>
        </div>
        <hr className="rule" />
        <div className="stack" style={{ gap: 8 }}>
          <div className="skeleton" style={{ height: 18, width: '60%' }} />
          <div className="skeleton" style={{ height: 18, width: '85%' }} />
          <div className="skeleton" style={{ height: 18, width: '40%' }} />
        </div>
        <div className="empty">Nothing planned. A free day.</div>
        <div className="card inset" style={{ padding: 14 }}>
          <div className="eyebrow">card.inset</div>
          <div>For a block inside a card: the upcoming days, a room's sensors.</div>
        </div>
      </div>
    </>
  );
}

/* ---------- Overlays ---------- */

function OverlaysSection({ setPreview }: { setPreview: (p: Preview) => void }) {
  const overlay = useOverlay();
  const [answer, setAnswer] = useState<string>('');
  const openSheet = () =>
    overlay.openSheet((close) => (
      <>
        <SheetHeader title="31" subtitle="Friday, October" onClose={close} />
        <div className="sheet-body">
          {['School drop-off', 'Team standup', 'Soccer practice'].map((t) => (
            <div key={t} className="row" style={{ minHeight: 52 }}>
              <span className="pill" style={{ '--pc': 'var(--p-leo)' } as CSSProperties}>
                {t}
              </span>
            </div>
          ))}
        </div>
        <button className="btn primary block" onClick={close}>
          ＋ Quick add
        </button>
      </>
    ));
  const openConfirm = async () => {
    const ok = await overlay.confirm({
      title: 'Unlock the front door?',
      body: 'It relocks itself after 5 minutes.',
      confirmLabel: 'Unlock',
      cancelLabel: 'Keep locked',
      danger: true,
    });
    setAnswer(ok ? 'Unlocked' : 'Kept locked');
    overlay.toast(ok ? 'Front door unlocked' : 'Front door stays locked', {
      tone: ok ? 'warn' : 'good',
    });
  };
  const openPopover = () =>
    overlay.showPopover(
      (close) => (
        <>
          <PopoverHeader
            eyebrow="Front door · just now"
            title="Someone's at the door"
            onClose={close}
          >
            <button className="btn sm">Unlock</button>
          </PopoverHeader>
          <div className="pop-body">
            <div className="pop-media">
              <span className="eyebrow" style={{ color: 'inherit' }}>
                Live view goes here
              </span>
            </div>
          </div>
        </>
      ),
      { durationMs: 10_000, label: 'Doorbell' },
    );
  return (
    <>
      <div className="card">
        <h2 className="h2">Sheet</h2>
        <p className="muted">
          Slides in from the right over a scrim. The Month screen's day sheet.
        </p>
        <div className="wrap">
          <button className="btn primary" onClick={openSheet}>
            Open sheet
          </button>
          <button
            className="btn"
            onClick={() =>
              overlay.openSheet(
                (close) => (
                  <>
                    <SheetHeader title="Settings" onClose={close} />
                    <div className="sheet-body muted">A wide sheet for denser content.</div>
                  </>
                ),
                { wide: true, label: 'Settings' },
              )
            }
          >
            Wide sheet
          </button>
        </div>
      </div>
      <div className="card">
        <h2 className="h2">Confirm</h2>
        <p className="muted">
          A promise that resolves true or false. <b>{answer}</b>
        </p>
        <div className="wrap">
          <button className="btn danger" onClick={openConfirm}>
            Unlock the door…
          </button>
          <button
            className="btn"
            onClick={() =>
              overlay
                .confirm({ title: 'Clear the list?', body: 'All 6 items will be removed.' })
                .then((ok) => setAnswer(ok ? 'Cleared' : 'Kept'))
            }
          >
            Plain confirm
          </button>
        </div>
      </div>
      <div className="card">
        <h2 className="h2">Pop-over</h2>
        <p className="muted">
          A large card over any screen with an optional countdown. The doorbell.
        </p>
        <div className="wrap">
          <button className="btn primary" onClick={openPopover}>
            Ring the doorbell
          </button>
        </div>
      </div>
      <div className="card">
        <h2 className="h2">Toast</h2>
        <p className="muted">Short, bottom centre, dismisses itself.</p>
        <div className="wrap">
          <button className="btn" onClick={() => overlay.toast('Added "Bananas" to Grocery')}>
            Toast
          </button>
          <button
            className="btn"
            onClick={() =>
              overlay.toast('Could not reach Home Assistant', {
                tone: 'warn',
                action: { label: 'Retry', onPress: () => overlay.toast('Reconnected') },
              })
            }
          >
            With action
          </button>
        </div>
      </div>
      <div className="card span">
        <h2 className="h2">Ambient and screen off</h2>
        <p className="muted">
          Ambient fades in over 700 ms with a slow photo drift and a 1.6 s cross-dissolve every 9 s.
          Tap anywhere to wake; the screens flash back in. Screen off is black with a faint clock.
        </p>
        <div className="wrap">
          <button className="btn primary" onClick={() => setPreview('ambient')}>
            Preview Ambient
          </button>
          <button className="btn" onClick={() => setPreview('off')}>
            Preview screen off
          </button>
        </div>
      </div>
    </>
  );
}

/* ---------- Schedule ---------- */

function ScheduleSection() {
  const schedule = useMemo(() => settingsFixture().schedule, []);
  const now = useNow();
  const [minutes, setMinutes] = useState(now.getHours() * 60 + now.getMinutes());
  const at = useMemo(() => {
    const d = new Date();
    d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    return d;
  }, [minutes]);
  const phase = phaseAt(schedule, at);
  const brightness = brightnessAt(schedule, at);
  useEffect(() => {
    setBrightness(brightness);
    return () => setBrightness(100);
  }, [brightness]);

  const segs = useMemo(() => {
    const amb = minutesOf(schedule.ambientFrom);
    const off = minutesOf(schedule.offFrom);
    const on = minutesOf(schedule.onAt);
    const color = (p: string) =>
      p === 'off' ? 'var(--ink)' : p === 'ambient' ? 'var(--ink-3)' : 'var(--accent)';
    const points = [0, on, amb, off, 1440].sort((a, b) => a - b);
    const out: Array<{ w: number; c: string }> = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      if (b <= a) continue;
      const probe = new Date();
      probe.setHours(Math.floor(a / 60), a % 60, 0, 0);
      out.push({ w: ((b - a) / 1440) * 100, c: color(phaseAt(schedule, probe)) });
    }
    return out;
  }, [schedule]);

  const label = `${((Math.floor(minutes / 60) + 11) % 12) + 1}:${String(minutes % 60).padStart(2, '0')} ${minutes >= 720 ? 'pm' : 'am'}`;
  return (
    <>
      <div className="card span">
        <div className="head">
          <h2 className="h2">Screen schedule</h2>
          <span className="n">
            From the server's settings: ambient from {schedule.ambientFrom}, off {schedule.offFrom}{' '}
            to {schedule.onAt}, idle after {schedule.idleSeconds} s
          </span>
        </div>
        <div className="sched">
          <input
            className="range"
            type="range"
            min={0}
            max={1439}
            value={minutes}
            aria-label="Time of day"
            style={{ '--v': `${(minutes / 1439) * 100}%` } as CSSProperties}
            onChange={(e) => setMinutes(+e.target.value)}
          />
          <div className="read">
            <b className="tnum">{label}</b>
          </div>
        </div>
        <div className="timeline" aria-hidden="true">
          {segs.map((s, i) => (
            <i key={i} style={{ width: `${s.w}%`, background: s.c }} />
          ))}
        </div>
        <div className="wrap">
          <span className={`chip${phase === 'on' ? '' : ' neutral'}`}>
            {phase === 'on'
              ? 'Screens on'
              : phase === 'ambient'
                ? 'Ambient when idle'
                : 'Screen off'}
          </span>
          <span className="chip neutral tnum">Brightness {brightness}%</span>
          <span className="small muted">
            The dimmer above everything follows the brightness; drag to see it.
          </span>
        </div>
        <div className="kv">
          {schedule.brightness.map((s) => (
            <div key={s.at}>
              <span className="tnum">{s.at}</span>
              <span className="tnum">{s.level}%</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
