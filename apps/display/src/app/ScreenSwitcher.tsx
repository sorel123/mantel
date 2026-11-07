import { guestAllows } from '@mantel/shared';
import {
  animate,
  motion,
  motionValue,
  useDragControls,
  useMotionValue,
  useMotionValueEvent,
  type PanInfo,
} from 'framer-motion';
import {
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import { usePersonFilter } from '../screens/today/personFilter';
import { EASE, STD, motionOr, useMotionPreference } from './motion';
import { ScreenBoundary } from './ScreenBoundary';

export interface SwitcherScreen {
  id: string;
  Component: ComponentType;
}

/** Space between neighbouring screens while one is dragged in. */
const GAP = 32;
/** Past this share of the width, or flicked faster than this (px/s), the swipe moves on. */
const DISTANCE = 0.22;
const VELOCITY = 450;
/** Where a swipe can't start: controls, and areas with their own sideways drag (Month's grid). */
const NO_SWIPE =
  'input, textarea, select, [data-no-swipe], .scroll-x, .range, [role="slider"], .mgrid .gridwrap, .wstrip .weekwrap';

/**
 * How far the current swipe has gone: 0 at rest, toward 1 dragging to the next screen, toward
 * -1 to the previous one. The dock slides its highlight with it. `committedAt` is when a swipe
 * last landed on a new screen, so the dock can jump there instead of animating twice.
 */
export const swipe = { progress: motionValue(0), committedAt: 0 };

/**
 * Shows one screen at a time. A horizontal drag anywhere that is not a control moves the screen
 * with the finger, the neighbour coming in beside it; let go past a fifth of the width (or flick)
 * and it springs over, else back. Picking a screen in the dock slides the new one in 24 px and
 * fades it up (320 ms). Vertical scrolling inside screens is left to the browser, and a drag that
 * starts on the Month grid belongs to the grid.
 */
export function ScreenSwitcher({
  screens: all,
  current,
  onChange,
}: {
  screens: SwitcherScreen[];
  current: string;
  onChange: (id: string) => void;
}) {
  const reduced = useMotionPreference();
  const { guest } = usePersonFilter();
  const screens = guest ? all.filter((s) => guestAllows(s.id)) : all;
  const index = screens.findIndex((s) => s.id === current);
  const screen = screens[index] ?? all.find((s) => s.id === current) ?? screens[0];
  const prevScreen = index >= 0 ? screens[index - 1] : undefined;
  const nextScreen = index >= 0 ? screens[index + 1] : undefined;

  // Direction of travel for the dock-tap entrance.
  const lastIndex = useRef(index);
  const dir = index >= lastIndex.current ? 1 : -1;
  lastIndex.current = index;

  const wrap = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const controls = useDragControls();
  /** Neighbours are mounted only while a swipe is under way. */
  const [peeking, setPeeking] = useState(false);
  const landed = useRef(false);
  const dragged = useRef(false);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const pitch = () => (wrap.current?.clientWidth ?? width) + GAP;

  useMotionValueEvent(x, 'change', (v) => {
    const w = pitch();
    swipe.progress.set(w > GAP ? -v / w : 0);
  });

  // A swipe landed: the neighbour that slid in is now the current screen at x = 0. Done before
  // paint so the frame never shows the old screen.
  useLayoutEffect(() => {
    if (!landed.current) return;
    landed.current = false;
    x.set(0);
    setPeeking(false);
  }, [current, x]);

  const onPointerDown = (e: PointerEvent) => {
    dragged.current = false;
    if (!prevScreen && !nextScreen) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if ((e.target as HTMLElement).closest(NO_SWIPE)) return;
    controls.start(e);
  };

  // A drag that ends over a button must not press it.
  const onClickCapture = (e: MouseEvent) => {
    if (!dragged.current) return;
    dragged.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  const settle = (_: unknown, info: PanInfo) => {
    const w = pitch();
    const off = info.offset.x;
    const v = info.velocity.x;
    const toNext = !!nextScreen && (off < -w * DISTANCE || (v < -VELOCITY && off < -24));
    const toPrev = !!prevScreen && (off > w * DISTANCE || (v > VELOCITY && off > 24));
    const target = toNext ? -w : toPrev ? w : 0;
    const to = toNext ? nextScreen : toPrev ? prevScreen : undefined;
    void animate(
      x,
      target,
      reduced
        ? { duration: 0 }
        : { type: 'spring', stiffness: 420, damping: 42, mass: 0.9, velocity: v },
    ).then(() => {
      if (to) {
        landed.current = true;
        swipe.committedAt = performance.now();
        onChange(to.id);
      } else {
        setPeeking(false);
      }
    });
  };

  if (!screen) return null;
  const pane = (s: SwitcherScreen, offset: -1 | 0 | 1) => {
    const active = offset === 0;
    return (
      <motion.section
        key={s.id}
        className={`screen${active ? ' screen-active' : ' screen-peek'}`}
        data-screen={active ? s.id : undefined}
        aria-hidden={active ? undefined : true}
        style={
          offset
            ? {
                left: `calc(${offset * 100}% + ${offset * GAP}px)`,
                right: `calc(${-offset * 100}% - ${offset * GAP}px)`,
                pointerEvents: 'none',
              }
            : undefined
        }
        initial={active && !peeking ? { opacity: 0, x: 24 * dir, scale: 0.985 } : false}
        animate={{ opacity: 1, x: 0, scale: 1 }}
        transition={motionOr(reduced, { duration: STD, ease: EASE })}
      >
        <ScreenBoundary name={s.id}>
          <s.Component />
        </ScreenBoundary>
      </motion.section>
    );
  };

  return (
    <div
      className="screens"
      ref={wrap}
      onPointerDown={onPointerDown}
      onClickCapture={onClickCapture}
    >
      <motion.div
        className="screen-track"
        style={{ x, position: 'absolute', inset: 0, touchAction: 'pan-y' }}
        drag="x"
        dragListener={false}
        dragControls={controls}
        dragDirectionLock
        dragMomentum={false}
        dragElastic={0.16}
        dragConstraints={{
          left: nextScreen ? -(width + GAP) : 0,
          right: prevScreen ? width + GAP : 0,
        }}
        onDragStart={() => {
          dragged.current = true;
          setPeeking(true);
        }}
        onDragEnd={settle}
      >
        {peeking && prevScreen && pane(prevScreen, -1)}
        {pane(screen, 0)}
        {peeking && nextScreen && pane(nextScreen, 1)}
      </motion.div>
    </div>
  );
}
