import { AnimatePresence, motion } from 'framer-motion';
import { useRef, type ComponentType, type PointerEvent } from 'react';
import { EASE, STD, motionOr, useMotionPreference } from './motion';

export interface SwitcherScreen {
  id: string;
  Component: ComponentType;
}

const SWIPE_X = 90;
const SWIPE_Y = 60;

/**
 * Shows one screen at a time. The leaving screen slides 24 px away and fades while the new one
 * slides in from the other side (320 ms), in the direction of travel along `screens`. A horizontal
 * swipe anywhere that is not a control moves to the neighbour.
 */
export function ScreenSwitcher({
  screens,
  current,
  onChange,
}: {
  screens: SwitcherScreen[];
  current: string;
  onChange: (id: string) => void;
}) {
  const reduced = useMotionPreference();
  const prev = useRef(current);
  const start = useRef<{ x: number; y: number } | null>(null);
  const index = screens.findIndex((s) => s.id === current);
  const dir = index >= screens.findIndex((s) => s.id === prev.current) ? 1 : -1;
  prev.current = current;
  const screen = screens[index] ?? screens[0];

  const onPointerDown = (e: PointerEvent) => {
    const el = e.target as HTMLElement;
    if (el.closest('input, textarea, [data-no-swipe], .scroll-x, .range, [role="slider"]')) {
      start.current = null;
      return;
    }
    start.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: PointerEvent) => {
    if (!start.current) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;
    start.current = null;
    if (Math.abs(dx) < SWIPE_X || Math.abs(dy) > SWIPE_Y) return;
    const next = screens[index + (dx < 0 ? 1 : -1)];
    if (next) onChange(next.id);
  };

  if (!screen) return null;
  return (
    <div
      className="screens"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (start.current = null)}
    >
      <AnimatePresence initial={false} custom={dir}>
        <motion.section
          key={screen.id}
          className="screen screen-active"
          data-screen={screen.id}
          custom={dir}
          variants={{
            enter: (d: number) => ({ opacity: 0, x: 24 * d, scale: 0.985 }),
            center: { opacity: 1, x: 0, scale: 1 },
            exit: (d: number) => ({ opacity: 0, x: -24 * d, scale: 0.985 }),
          }}
          initial="enter"
          animate="center"
          exit="exit"
          transition={motionOr(reduced, { duration: STD, ease: EASE })}
        >
          <screen.Component />
        </motion.section>
      </AnimatePresence>
    </div>
  );
}
