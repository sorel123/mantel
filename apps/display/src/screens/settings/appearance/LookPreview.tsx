import { FONTS, TEXT_SCALE, type Appearance, type Skin } from '@mantel/shared';
import type { CSSProperties } from 'react';
import type { Mode } from '../../../lib/theme';
import { skinVars } from './SkinTile';

/**
 * A miniature Today screen in the chosen skin, accent, headline font and text size, so every
 * change in Appearance shows at once. Static content; "Preview on the wall" shows the real one.
 */
export function LookPreview({
  skin,
  mode,
  appearance,
}: {
  skin: Skin;
  mode: Mode;
  appearance: Appearance;
}) {
  const people = skin.personPalette;
  const style = {
    ...skinVars(skin, mode),
    '--text-scale': TEXT_SCALE[appearance.textSize],
  } as CSSProperties;
  const p = (i: number) => people[i % people.length]?.color ?? 'var(--accent)';
  return (
    <div
      className="sk-look"
      data-card-style={skin.cardStyle}
      style={style}
      role="img"
      aria-label={`Preview: ${skin.name}, ${FONTS[skin.fonts.display].name} headlines, ${appearance.textSize} text`}
    >
      <div className="lk-left">
        <div className="lk-date">
          <span className="lk-dow">Saturday</span>
          <span className="lk-day">October 31</span>
        </div>
        <div className="lk-card lk-wx">
          <span className="lk-temp tnum">54°</span>
          <span className="lk-sub">Partly cloudy · H 61° L 47°</span>
          <span className="lk-quip">Sun and clouds taking turns. Both are welcome.</span>
        </div>
      </div>
      <div className="lk-card lk-agenda">
        <div className="lk-h">Today</div>
        {[
          ['8:30', 'Pancakes', 0],
          ['10:00', 'Leo soccer', 1],
          ['4:00', 'Trick-or-treat walk', 2],
        ].map(([time, title, who]) => (
          <div
            className="lk-ev"
            key={String(title)}
            style={{ '--pc': p(Number(who)) } as CSSProperties}
          >
            <span className="lk-t tnum">{time}</span>
            <span className="lk-title">{title}</span>
          </div>
        ))}
        <span className="lk-btn">＋ Add</span>
      </div>
    </div>
  );
}
