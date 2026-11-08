import type { Person } from '@mantel/shared';
import { guestAllows } from '@mantel/shared';
import { animate, motion, useMotionValue, useTransform } from 'framer-motion';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  PersonChips,
  personFilter,
  usePersonFilter,
  usePersonFilterTimeout,
} from '../screens/today/personFilter';
import { EASE, STD, useMotionPreference } from './motion';
import { useOverlay } from './overlay';
import { swipe } from './ScreenSwitcher';

export interface DockItem {
  id: string;
  label: string;
  /** Inner SVG for a 24×24 stroke icon. */
  icon: string;
}

const HOLD_MS = 1100;

interface Box {
  left: number;
  width: number;
}

/**
 * The floating tab bar. On the left, the household's faces (tap one to show only their things,
 * tap again or wait a minute to clear) and the Guest chip; then the tabs, whose highlight slides
 * between them and follows a swipe in step; past a divider the clock (holding it for a second
 * calls `onClockHold`: the way into settings from the wall), the keep-awake pin and the moon.
 */
export function Dock({
  items: all,
  current,
  onSelect,
  clock,
  date,
  onClockHold,
  onAmbient,
  awake,
  onAwake,
  people,
  trailing,
}: {
  items: DockItem[];
  current: string;
  onSelect: (id: string) => void;
  clock?: string;
  /** Shown before the time, e.g. `Sun 2`. */
  date?: string;
  onClockHold?: () => void;
  onAmbient?: () => void;
  /** The keep-awake pin: lit while the display is held out of Ambient. */
  awake?: { held: boolean; label: string };
  onAwake?: () => void;
  /** The household, for the person filter and Guest chips on the left. */
  people?: Person[];
  trailing?: ReactNode;
}) {
  const reduced = useMotionPreference();
  const { guest } = usePersonFilter();
  const items = guest ? all.filter((s) => guestAllows(s.id)) : all;
  const hold = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const startHold = () => {
    clearTimeout(hold.current);
    if (onClockHold) hold.current = setTimeout(onClockHold, HOLD_MS);
  };
  const endHold = () => clearTimeout(hold.current);

  // Guest mode hides Lists and Home; step off them when it comes on.
  useEffect(() => {
    if (guest && !guestAllows(current) && all.some((s) => s.id === current))
      onSelect(items[0]?.id ?? 'today');
  }, [guest, current]); // eslint-disable-line react-hooks/exhaustive-deps

  /* The highlight: measured from the tabs, sliding on a tap and following a swipe. */
  const nav = useRef<HTMLElement>(null);
  const tabs = useRef(new Map<string, HTMLButtonElement>());
  const geo = useRef<{ cur?: Box; prev?: Box; next?: Box }>({});
  const baseX = useMotionValue(0);
  const baseW = useMotionValue(0);
  const [band, setBand] = useState<{ top: number; height: number } | null>(null);
  const index = items.findIndex((s) => s.id === current);
  const ids = items.map((s) => s.id).join();
  const peopleKey = people?.map((p) => p.id).join() ?? '';

  useLayoutEffect(() => {
    const measure = (animated: boolean) => {
      const box = (id?: string): Box | undefined => {
        const el = id ? tabs.current.get(id) : undefined;
        return el ? { left: el.offsetLeft, width: el.offsetWidth } : undefined;
      };
      const cur = box(items[index]?.id);
      geo.current = { cur, prev: box(items[index - 1]?.id), next: box(items[index + 1]?.id) };
      const el = items[index] && tabs.current.get(items[index].id);
      if (!cur || !el) return setBand(null);
      setBand({ top: el.offsetTop, height: el.offsetHeight });
      // Just landed from a swipe: the highlight is already there.
      const jump = !animated || reduced || performance.now() - swipe.committedAt < 250;
      if (jump || baseW.get() === 0) {
        baseX.set(cur.left);
        baseW.set(cur.width);
      } else {
        const t = { duration: STD, ease: EASE };
        void animate(baseX, cur.left, t);
        void animate(baseW, cur.width, t);
      }
    };
    measure(true);
    const el = nav.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure(false));
    ro.observe(el);
    return () => ro.disconnect();
  }, [index, ids, peopleKey, clock, date, reduced]); // eslint-disable-line react-hooks/exhaustive-deps

  const lerp = (p: number, pick: 'left' | 'width', base: number) => {
    const { cur, prev, next } = geo.current;
    const to = p > 0 ? next : prev;
    if (!cur || !to || p === 0) return base;
    return base + Math.min(1, Math.abs(p)) * (to[pick] - cur[pick]);
  };
  const indX = useTransform(() => lerp(swipe.progress.get(), 'left', baseX.get()));
  const indW = useTransform(() => lerp(swipe.progress.get(), 'width', baseW.get()));

  return (
    <nav className="dock" aria-label="Screens" data-no-swipe ref={nav}>
      {people && people.length > 0 && (
        <>
          <DockPeople people={people} />
          <span className="sep" />
        </>
      )}
      {band && index >= 0 && (
        <motion.span
          className="ind"
          aria-hidden="true"
          style={{
            x: indX,
            width: indW,
            left: 0,
            right: 'auto',
            top: band.top,
            bottom: 'auto',
            height: band.height,
          }}
        />
      )}
      {items.map((s) => {
        const active = s.id === current;
        return (
          <button
            key={s.id}
            ref={(el) => {
              if (el) tabs.current.set(s.id, el);
              else tabs.current.delete(s.id);
            }}
            className="tab"
            aria-current={active ? 'page' : undefined}
            onClick={() => onSelect(s.id)}
          >
            <svg viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: s.icon }} />
            <span>{s.label}</span>
          </button>
        );
      })}
      {(clock || onAmbient || onAwake || trailing) && <span className="sep" />}
      {clock && (
        <button
          type="button"
          className="clock tnum"
          aria-label={`${date ? `${date}, ` : ''}${clock}. Hold to open settings`}
          onPointerDown={startHold}
          onPointerUp={endHold}
          onPointerLeave={endHold}
          onPointerCancel={endHold}
          onContextMenu={(e) => e.preventDefault()}
        >
          {date && <span className="date">{date}</span>}
          {clock}
        </button>
      )}
      {trailing}
      {onAwake && (
        <button
          type="button"
          className={`moon awake${awake?.held ? ' on' : ''}`}
          aria-label={awake?.held ? `Staying on ${awake.label}. Change` : 'Keep the screen on'}
          aria-pressed={!!awake?.held}
          onClick={onAwake}
        >
          <svg viewBox="0 0 24 24">
            <path d="M9 3h6l-1 6 3 3v2H7v-2l3-3z" />
            <path d="M12 14v7" />
          </svg>
        </button>
      )}
      {onAmbient && (
        <button className="moon" aria-label="Ambient mode" onClick={onAmbient}>
          <svg viewBox="0 0 24 24">
            <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
          </svg>
        </button>
      )}
    </nav>
  );
}

/** The person chips and the Guest chip. Clears a person choice after a minute untouched. */
function DockPeople({ people }: { people: Person[] }) {
  const { blocking } = useOverlay();
  const { guest } = usePersonFilter();
  usePersonFilterTimeout(blocking);
  return (
    <span className="dock-people cal">
      {!guest && <PersonChips people={people} />}
      <button
        type="button"
        className={`pf-chip guest${guest ? ' on' : ''}`}
        aria-pressed={guest}
        aria-label={
          guest ? 'Guest mode is on. Turn off' : 'Guest mode: calendar, weather and photos only'
        }
        onClick={() => personFilter.setGuest(!guest)}
      >
        <span className="av">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="8" r="3.5" />
            <path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" />
          </svg>
        </span>
        {guest && <span className="guest-label">Guest</span>}
      </button>
    </span>
  );
}
