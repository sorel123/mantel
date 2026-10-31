import { FONTS, type Skin } from '@mantel/shared';
import type { CSSProperties } from 'react';
import type { Mode } from '../../../lib/theme';

/** Inline variables so a tile (or a preview) renders in a skin's own colours and fonts. */
export function skinVars(skin: Skin, mode: Mode): CSSProperties {
  const t = skin[mode];
  return {
    '--bg': t.bg,
    '--surface': t.surface,
    '--surface-2': t.surface2,
    '--ink': t.ink,
    '--ink-2': t.ink2,
    '--ink-3': t.ink3,
    '--line': t.line,
    '--accent': t.accent,
    '--accent-soft': t.accentSoft,
    '--accent-ink': t.accentInk,
    '--warn': t.warn,
    '--good': t.good,
    '--display': FONTS[skin.fonts.display].stack,
    '--body': FONTS[skin.fonts.body].stack,
    '--radius-scale': skin.radii,
  } as CSSProperties;
}

/**
 * A small live preview of a skin: its background, a headline in its display face, two cards
 * and an accent pill, in the given mode. A button when `onSelect` is given.
 */
export function SkinTile({
  skin,
  mode,
  selected,
  onSelect,
  badge,
}: {
  skin: Skin;
  mode: Mode;
  selected?: boolean;
  onSelect?: () => void;
  badge?: string;
}) {
  const art = (
    <div className="sk-art" data-card-style={skin.cardStyle} style={skinVars(skin, mode)}>
      <div className="sk-head">
        <span className="sk-aa">Aa</span>
        <span className="sk-dot" />
      </div>
      <div className="sk-cards">
        <div className="sk-card">
          <i style={{ width: '70%' }} />
          <i className="faint" style={{ width: '45%' }} />
        </div>
        <div className="sk-card">
          <i style={{ width: '55%' }} />
          <span className="sk-pill" />
        </div>
      </div>
    </div>
  );
  const meta = (
    <div className="sk-meta">
      <b>{skin.name}</b>
      <span>{badge ?? skin.tags.slice(0, 2).join(' · ')}</span>
    </div>
  );
  if (!onSelect)
    return (
      <div className="sk-tile">
        {art}
        {meta}
      </div>
    );
  return (
    <button
      type="button"
      className="sk-tile"
      aria-pressed={!!selected}
      aria-label={`${skin.name} skin`}
      onClick={onSelect}
    >
      {art}
      {meta}
    </button>
  );
}
