import { motion } from 'framer-motion';
import { useRef, type ReactNode } from 'react';
import { EASE, STD, motionOr, useMotionPreference } from './motion';

export interface DockItem {
  id: string;
  label: string;
  /** Inner SVG for a 24×24 stroke icon. */
  icon: string;
}

const HOLD_MS = 1100;

/**
 * The floating tab bar. The highlight slides between tabs (a shared-layout element), the clock
 * sits past a divider (holding it for a second calls `onClockHold`: the way into settings from
 * the wall) and the moon starts Ambient by hand.
 */
export function Dock({
  items,
  current,
  onSelect,
  clock,
  onClockHold,
  onAmbient,
  trailing,
}: {
  items: DockItem[];
  current: string;
  onSelect: (id: string) => void;
  clock?: string;
  onClockHold?: () => void;
  onAmbient?: () => void;
  trailing?: ReactNode;
}) {
  const reduced = useMotionPreference();
  const hold = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const startHold = () => {
    clearTimeout(hold.current);
    if (onClockHold) hold.current = setTimeout(onClockHold, HOLD_MS);
  };
  const endHold = () => clearTimeout(hold.current);
  return (
    <nav className="dock" aria-label="Screens" data-no-swipe>
      {items.map((s) => {
        const active = s.id === current;
        return (
          <button
            key={s.id}
            className="tab"
            aria-current={active ? 'page' : undefined}
            onClick={() => onSelect(s.id)}
          >
            {active && (
              <motion.span
                className="ind"
                layoutId="dock-indicator"
                transition={motionOr(reduced, { duration: STD, ease: EASE })}
                aria-hidden="true"
              />
            )}
            <svg viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: s.icon }} />
            <span>{s.label}</span>
          </button>
        );
      })}
      {(clock || onAmbient || trailing) && <span className="sep" />}
      {clock && (
        <button
          type="button"
          className="clock tnum"
          aria-label={`${clock}. Hold to open settings`}
          onPointerDown={startHold}
          onPointerUp={endHold}
          onPointerLeave={endHold}
          onPointerCancel={endHold}
          onContextMenu={(e) => e.preventDefault()}
        >
          {clock}
        </button>
      )}
      {trailing}
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
