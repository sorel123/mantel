import { DEFAULT_CHORE_SETTINGS, type ChoreSettings } from '@mantel/shared';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { SLOW, useMotionPreference } from '../../app/motion';

/**
 * Celebrations on the chore chart: a small particle burst on every star, a bigger one plus a
 * banner when someone finishes everything for the part of the day or spends stars on a reward.
 * Silent unless the household turned the chime on; nothing at all for a person whose
 * celebrations are off; no particles under `prefers-reduced-motion` (the banner still shows).
 */
export interface CelebrateApi {
  /** A burst from the middle of `at`. `big` for a finished routine or a reward. */
  burst(at: Element | null, personId: string, big?: boolean): void;
  /** The banner across the top, with a big burst from the middle of the screen. */
  banner(text: string, personId: string): void;
}

const Ctx = createContext<CelebrateApi>({ burst: () => {}, banner: () => {} });
export const useCelebrate = () => useContext(Ctx);

interface Burst {
  id: number;
  x: number;
  y: number;
  big: boolean;
}

/** Particle colours: tokens only, plus the person's own colour. */
const COLOURS = ['var(--warn)', 'var(--accent)', 'var(--good)', 'var(--pc)'];
const BANNER_SLOWS = 4; // the banner stays four "slow" durations (2.8 s)

let audio: AudioContext | null = null;
/** Two soft notes, a fifth apart. Only when the household turned the chime on. */
function chime(big: boolean) {
  try {
    audio ??= new AudioContext();
    const ctx = audio;
    const notes = big ? [660, 880, 990] : [880, 1320];
    notes.forEach((f, i) => {
      const t = ctx.currentTime + i * 0.09;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.12, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.55);
    });
  } catch {
    /* no audio on this device */
  }
}

export function CelebrationLayer({
  settings = DEFAULT_CHORE_SETTINGS,
  color,
  children,
}: {
  settings?: ChoreSettings;
  /** A person's colour for the particles, by id. */
  color: (personId: string) => string | undefined;
  children: ReactNode;
}) {
  const reduced = useMotionPreference();
  const host = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const [bursts, setBursts] = useState<Array<Burst & { pc?: string }>>([]);
  const [banner, setBanner] = useState<{ id: number; text: string; pc?: string } | null>(null);

  const off = useCallback(
    (personId: string) => settings.celebrationsOff.includes(personId),
    [settings.celebrationsOff],
  );

  const spawn = useCallback(
    (x: number, y: number, big: boolean, personId: string) => {
      if (reduced) return;
      const id = ++seq.current;
      setBursts((b) => [...b, { id, x, y, big, pc: color(personId) }]);
      window.setTimeout(
        () => setBursts((b) => b.filter((x) => x.id !== id)),
        SLOW * 1000 * (big ? 1.6 : 1) + 100,
      );
    },
    [reduced, color],
  );

  const api = useMemo<CelebrateApi>(
    () => ({
      burst(at, personId, big = false) {
        if (off(personId)) return;
        if (settings.chime) chime(big);
        const box = host.current;
        if (!at || !box) return;
        const hb = box.getBoundingClientRect();
        // The panel may be scaled to fit the screen; work in the layer's own pixels.
        const scale = hb.width / (box.offsetWidth || hb.width);
        const r = at.getBoundingClientRect();
        spawn(
          (r.left + r.width / 2 - hb.left) / scale,
          (r.top + r.height / 2 - hb.top) / scale,
          big,
          personId,
        );
      },
      banner(text, personId) {
        if (off(personId)) return;
        if (settings.chime) chime(true);
        const id = ++seq.current;
        setBanner({ id, text, pc: color(personId) });
        window.setTimeout(
          () => setBanner((b) => (b?.id === id ? null : b)),
          SLOW * 1000 * BANNER_SLOWS,
        );
        const box = host.current;
        if (box) spawn(box.offsetWidth / 2, box.offsetHeight / 3, true, personId);
      },
    }),
    [off, settings.chime, spawn, color],
  );

  return (
    <Ctx.Provider value={api}>
      <div className="celebrate-host" ref={host}>
        {children}
        <div className="celebrate" aria-hidden>
          {bursts.map((b) => (
            <Particles key={b.id} burst={b} />
          ))}
        </div>
        <div className="celebrate-live" role="status" aria-live="polite">
          {banner && (
            <div
              key={banner.id}
              className="cbanner"
              style={{ '--pc': banner.pc ?? 'var(--accent)' } as CSSProperties}
            >
              {banner.text}
            </div>
          )}
        </div>
      </div>
    </Ctx.Provider>
  );
}

function Particles({ burst }: { burst: Burst & { pc?: string } }) {
  // Fixed per burst: angles evenly spread with a little jitter, distances by size.
  const parts = useMemo(() => {
    const n = burst.big ? 28 : 12;
    const reach = burst.big ? 220 : 70;
    return Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const d = reach * (0.55 + Math.random() * 0.45);
      return {
        dx: Math.cos(a) * d,
        dy: Math.sin(a) * d - (burst.big ? 30 : 10),
        rot: Math.round(Math.random() * 360),
        c: COLOURS[i % COLOURS.length]!,
        star: i % 3 === 0,
      };
    });
  }, [burst.big]);
  return (
    <span
      className={`cburst${burst.big ? ' big' : ''}`}
      style={{ left: burst.x, top: burst.y, '--pc': burst.pc ?? 'var(--accent)' } as CSSProperties}
    >
      {parts.map((p, i) => (
        <i
          key={i}
          className={p.star ? 'st' : undefined}
          style={
            {
              '--dx': `${p.dx}px`,
              '--dy': `${p.dy}px`,
              '--rot': `${p.rot}deg`,
              '--c': p.c,
            } as CSSProperties
          }
        />
      ))}
    </span>
  );
}
