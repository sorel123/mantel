/**
 * Pure helpers for arranging the Home screen: which cards there are, in the household's saved
 * order, and moves for the Arrange mode. A card Home Assistant adds later (a new room, a new
 * camera) lands next to its neighbour in the default order, so a saved layout never hides it.
 */
import type { CameraStyle, HomeCardPlace, HomeLayout } from '@mantel/shared';

export const CAMERAS = 'cameras';
export const CLIMATE = 'climate';
export const MEDIA = 'media';
export const roomKey = (areaId: string) => `room:${areaId}`;
export const cameraKey = (entityId: string) => `camera:${entityId}`;
export const isCamera = (key: string) => key.startsWith('camera:');
export const cameraIdOf = (key: string) => key.slice('camera:'.length);

/** Cameras and Now Playing start in the right-hand column, the rest in the grid. */
const sideByDefault = (key: string) => key === CAMERAS || key === MEDIA || isCamera(key);

const place = (key: string): HomeCardPlace => ({
  key,
  side: sideByDefault(key),
  hidden: false,
  wide: false,
});

/**
 * Every card there is, in order: the saved places first, then each new card after the card
 * before it in `defaults` (or first, when nothing before it is placed). Saved cards that no
 * longer exist are dropped.
 */
export function resolveCards(defaults: string[], saved: HomeCardPlace[]): HomeCardPlace[] {
  const exists = new Set(defaults);
  const seen = new Set<string>();
  const out: HomeCardPlace[] = [];
  for (const c of saved)
    if (exists.has(c.key) && !seen.has(c.key)) {
      out.push({ ...c });
      seen.add(c.key);
    }
  defaults.forEach((key, i) => {
    if (seen.has(key)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const idx = out.findIndex((c) => c.key === defaults[j]);
      if (idx >= 0) {
        at = idx + 1;
        break;
      }
    }
    const fresh = place(key);
    // A new camera follows where the cameras already are.
    if (isCamera(key) && at > 0) fresh.side = out[at - 1]!.side;
    out.splice(at, 0, fresh);
    seen.add(key);
  });
  return out;
}

/** Is this card drawn on its own with this camera style? */
export const standsAlone = (key: string, style: CameraStyle) =>
  style === 'cards' ? key !== CAMERAS : !isCamera(key);

/**
 * Move `key` one step earlier (-1) or later (+1) among the cards it shares a column with, or,
 * for a camera inside the cameras card, among the other cameras.
 */
export function moveCard(
  cards: HomeCardPlace[],
  key: string,
  dir: -1 | 1,
  style: CameraStyle,
): HomeCardPlace[] {
  const from = cards.findIndex((c) => c.key === key);
  if (from < 0) return cards;
  const me = cards[from]!;
  const inGroup = isCamera(key) && style !== 'cards';
  const peer = (c: HomeCardPlace) =>
    !c.hidden && (inGroup ? isCamera(c.key) : standsAlone(c.key, style) && c.side === me.side);
  let to = from + dir;
  while (to >= 0 && to < cards.length && !peer(cards[to]!)) to += dir;
  if (to < 0 || to >= cards.length) return cards;
  const next = [...cards];
  next.splice(from, 1);
  next.splice(to, 0, me);
  return next;
}

export function patchCard(
  cards: HomeCardPlace[],
  key: string,
  patch: Partial<Omit<HomeCardPlace, 'key'>>,
): HomeCardPlace[] {
  return cards.map((c) => (c.key === key ? { ...c, ...patch } : c));
}

/** Move a card to the other column, at the end of it. */
export function switchSide(cards: HomeCardPlace[], key: string): HomeCardPlace[] {
  const me = cards.find((c) => c.key === key);
  if (!me) return cards;
  const rest = cards.filter((c) => c.key !== key);
  return [...rest, { ...me, side: !me.side, wide: false }];
}

/** The saved form: only what differs from the defaults is worth keeping, but order matters, so keep all. */
export const toLayout = (cards: HomeCardPlace[], cameraStyle: CameraStyle): HomeLayout => ({
  cards: cards.map(({ key, side, hidden, wide }) => ({ key, side, hidden, wide })),
  cameraStyle,
});

export const CAMERA_STYLES: Array<{ id: CameraStyle; label: string }> = [
  { id: 'feature', label: 'One big' },
  { id: 'grid', label: 'Grid' },
  { id: 'cards', label: 'Separate' },
];
