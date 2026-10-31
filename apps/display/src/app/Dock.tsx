import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { EASE, STD, motionOr, useMotionPreference } from './motion';

export interface DockItem {
  id: string;
  label: string;
  /** Inner SVG for a 24×24 stroke icon. */
  icon: string;
}

/**
 * The floating tab bar. The highlight slides between tabs (a shared-layout element), the clock
 * sits past a divider and the moon starts Ambient by hand.
 */
export function Dock({
  items,
  current,
  onSelect,
  clock,
  onAmbient,
  trailing,
}: {
  items: DockItem[];
  current: string;
  onSelect: (id: string) => void;
  clock?: string;
  onAmbient?: () => void;
  trailing?: ReactNode;
}) {
  const reduced = useMotionPreference();
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
      {clock && <span className="clock tnum">{clock}</span>}
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
