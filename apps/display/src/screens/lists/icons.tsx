import { CHORE_ICONS, type ChoreIconKey } from '@mantel/shared';
import type { ReactNode } from 'react';

/**
 * The bundled chore, routine and reward icons: simple line drawings on a 24 px grid, big and
 * plain enough for children who can't read yet. Keys match `CHORE_ICONS` in the contract; an
 * unknown key draws a star.
 */
const ICONS: Record<ChoreIconKey, ReactNode> = {
  toothbrush: (
    <>
      <path d="M4 20 15 9" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" transform="rotate(45 17.5 6.5)" />
      <path d="M15.5 4.5v-2M18 5V3M20.5 7.5h2" />
    </>
  ),
  bed: (
    <>
      <path d="M3 18V6M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5" />
      <circle cx="7" cy="11" r="2" />
    </>
  ),
  backpack: (
    <>
      <path d="M6 9a6 6 0 0 1 12 0v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z" />
      <path d="M9 5V3h6v2M9 14h6v4H9z" />
    </>
  ),
  dog: (
    <>
      <path d="M5 9 3 5l4 1 2-2h5l2 2 4-1-2 4" />
      <path d="M6 9v5a6 6 0 0 0 12 0V9" />
      <circle cx="9.5" cy="11.5" r=".6" />
      <circle cx="14.5" cy="11.5" r=".6" />
      <path d="M11 15h2l-1 1.2z" />
    </>
  ),
  cat: (
    <>
      <path d="M5 20V8l3-4 2 4h4l2-4 3 4v12z" />
      <circle cx="9.5" cy="13" r=".6" />
      <circle cx="14.5" cy="13" r=".6" />
      <path d="M11 16h2" />
    </>
  ),
  fish: (
    <>
      <path d="M3 12c3-5 10-6 14 0-4 6-11 5-14 0z" />
      <path d="m17 12 4-4v8z" />
      <circle cx="7.5" cy="11" r=".6" />
    </>
  ),
  dishes: (
    <>
      <circle cx="10" cy="12" r="7" />
      <circle cx="10" cy="12" r="3.5" />
      <path d="M20 4v16M18 4v5a2 2 0 0 0 4 0V4" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  recycle: (
    <>
      <path d="m7 19-3-5 2-3.5M10 19h7l2-3.5M12 4l3.5 6M8.5 10 12 4" />
      <path d="m4 14 2.5-3.5 3 1M17 19l2-3.5-3-.5M15.5 10l-3.5.5" />
    </>
  ),
  book: (
    <>
      <path d="M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2z" />
      <path d="M4 20a2 2 0 0 0 2 1h13v-3M8 7h7" />
    </>
  ),
  shower: (
    <>
      <path d="M5 21V6a3 3 0 0 1 6 0" />
      <path d="M8 9h7l-3-3" />
      <path d="M10 13v1M14 13v1M18 13v1M12 17v1M16 17v1" />
    </>
  ),
  bath: (
    <>
      <path d="M3 12h18v2a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5z" />
      <path d="M6 12V6a2 2 0 0 1 4 0M7 19l-1 2M17 19l1 2" />
    </>
  ),
  shirt: <path d="M8 3 3 6l2 5 3-1v11h8V10l3 1 2-5-5-3a4 4 0 0 1-8 0z" />,
  socks: (
    <>
      <path d="M8 3h6v8l-5 6a3 3 0 0 1-4.5-4L8 9z" />
      <path d="M8 6h6" />
    </>
  ),
  shoes: (
    <>
      <path d="M3 17V9l5 1 3 3 8 1a2 2 0 0 1 2 2v1z" />
      <path d="M3 17h18v2H3zM8 10v3M11 13l1-2" />
    </>
  ),
  laundry: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <circle cx="12" cy="13" r="4.5" />
      <path d="M7 6h.01M10 6h.01" />
    </>
  ),
  broom: (
    <>
      <path d="m20 4-8 8" />
      <path d="m11 11 3 3-2 7c-3-1-6-3-8-6l7-2z" />
      <path d="M7 16.5 9 15M9 19l1.5-1.5" />
    </>
  ),
  vacuum: (
    <>
      <path d="M14 3h3v13" />
      <path d="M5 21h12a3 3 0 0 0 0-6H8a3 3 0 0 0-3 3z" />
      <circle cx="8" cy="21" r=".6" />
    </>
  ),
  sponge: (
    <>
      <rect x="3" y="8" width="18" height="10" rx="2" />
      <path d="M3 12h18M7 15h.01M11 15.5h.01M15 15h.01M18 4.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z" />
    </>
  ),
  plant: (
    <>
      <path d="M6 14h12l-2 7H8z" />
      <path d="M12 14V8M12 9C12 5 9 3 5 4c0 4 3 5 7 5zM12 10c0-3 2.5-5 6-4.5 0 3-2.5 4.5-6 4.5z" />
    </>
  ),
  table: <path d="M3 9h18M5 9v11M19 9v11M5 14h14M7 5h10" />,
  fork: (
    <>
      <path d="M7 3v6a2 2 0 0 0 4 0V3M9 3v18" />
      <path d="M17 21V3c-2 1-3 4-3 8h3" />
    </>
  ),
  apple: (
    <>
      <path d="M12 8c-3-2-8-1-8 5 0 5 4 9 6 8l2-1 2 1c2 1 6-3 6-8 0-6-5-7-8-5z" />
      <path d="M12 8c0-3 1-4 3-5" />
    </>
  ),
  water: (
    <>
      <path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z" />
      <path d="M9 14a3 3 0 0 0 3 3" />
    </>
  ),
  pill: (
    <>
      <rect x="2.5" y="8.5" width="19" height="7" rx="3.5" transform="rotate(-45 12 12)" />
      <path d="m9.5 9.5 5 5" />
    </>
  ),
  hairbrush: (
    <>
      <rect x="4" y="3" width="9" height="11" rx="4.5" />
      <path d="M8.5 14v7M7 6v5M10 6v5" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  homework: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </>
  ),
  pencil: (
    <>
      <path d="M4 20 5 15 16 4l4 4L9 19z" />
      <path d="m14 6 4 4" />
    </>
  ),
  music: (
    <>
      <path d="M9 18V5l11-2v13" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="17.5" cy="16" r="2.5" />
    </>
  ),
  ball: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3.5 9c5 1 12 1 17 0M3.5 15c5-1 12-1 17 0M12 3c-3 5-3 13 0 18M12 3c3 5 3 13 0 18" />
    </>
  ),
  bike: (
    <>
      <circle cx="5.5" cy="16" r="3.5" />
      <circle cx="18.5" cy="16" r="3.5" />
      <path d="m5.5 16 4-7h6l3 7M9.5 9l3 7h-7M13 6h3" />
    </>
  ),
  toys: (
    <>
      <rect x="3" y="13" width="8" height="8" rx="1" />
      <rect x="13" y="13" width="8" height="8" rx="1" />
      <rect x="8" y="4" width="8" height="8" rx="1" />
    </>
  ),
  car: (
    <>
      <path d="M3 16v-4l2-5h14l2 5v4z" />
      <path d="M3 12h18" />
      <circle cx="7" cy="17" r="2" />
      <circle cx="17" cy="17" r="2" />
    </>
  ),
  phone: (
    <>
      <rect x="6" y="2" width="12" height="20" rx="2.5" />
      <path d="M11 18h2" />
    </>
  ),
  tv: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="m8 2 4 4 4-4M8 21h8" />
    </>
  ),
  gift: (
    <>
      <rect x="3" y="8" width="18" height="5" rx="1" />
      <path d="M5 13v8h14v-8M12 8v13" />
      <path d="M12 8C9 8 7 7 7 5s3-2 5 3c2-5 5-5 5-3s-2 3-5 3z" />
    </>
  ),
  icecream: (
    <>
      <path d="M7 11h10l-5 11z" />
      <path d="M7 11a5 5 0 0 1 10 0" />
    </>
  ),
  pizza: (
    <>
      <path d="M12 21 3 6c6-4 12-4 18 0z" />
      <path d="M4.5 8.5c5-3 10-3 15 0" />
      <circle cx="10" cy="11" r="1" />
      <circle cx="14" cy="14" r="1" />
    </>
  ),
  cookie: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9h.01M15 10h.01M10 15h.01M15 15h.01M12 12h.01" />
    </>
  ),
  movie: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="m3 7 3-4 4 4M10 7l4-4 4 4" />
    </>
  ),
  game: (
    <>
      <path d="M6 8h12a4 4 0 0 1 3.8 5.2l-1.3 4A2.5 2.5 0 0 1 16 18l-2-2h-4l-2 2a2.5 2.5 0 0 1-4.5-.8l-1.3-4A4 4 0 0 1 6 8z" />
      <path d="M8 11v3M6.5 12.5h3M15 12h.01M17 13h.01" />
    </>
  ),
  park: (
    <>
      <path d="M12 3 6 12h3l-4 6h14l-4-6h3z" />
      <path d="M12 18v3" />
    </>
  ),
  heart: <path d="M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z" />,
  star: <path d="M12 3.2l2.6 5.5 6 .8-4.4 4.1 1.1 5.9L12 16.6l-5.3 2.9 1.1-5.9-4.4-4.1 6-.8z" />,
  trophy: (
    <>
      <path d="M7 4h10v5a5 5 0 0 1-10 0z" />
      <path d="M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M12 14v4M8 21h8M9 18h6" />
    </>
  ),
  coin: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M15 9a3 3 0 0 0-3-1.5c-2 0-3 1-3 2.2C9 13 15 11 15 14.3c0 1.2-1 2.2-3 2.2A3 3 0 0 1 9 15M12 6v1.5M12 16.5V18" />
    </>
  ),
  crown: <path d="M3 18 2 7l5 4 5-7 5 7 5-4-1 11z" />,
};

/** Whether a key has a drawing (anything else draws the star). */
export const hasIcon = (key: string): key is ChoreIconKey => key in ICONS;

/** Human words for the icon picker. */
export const iconLabel = (key: string) =>
  key === 'icecream' ? 'ice cream' : key === 'tv' ? 'TV' : key;

export function ChoreIconSvg({
  icon,
  className = '',
  label,
}: {
  icon?: string | null;
  className?: string;
  /** Read aloud when given; otherwise the icon is decoration. */
  label?: string;
}) {
  const key: ChoreIconKey = icon && hasIcon(icon) ? icon : 'star';
  return (
    <svg
      viewBox="0 0 24 24"
      className={`cicon ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {ICONS[key]}
    </svg>
  );
}

export { CHORE_ICONS };
