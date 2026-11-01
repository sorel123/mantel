import type { Skin } from '@mantel/shared';
import type { CSSProperties } from 'react';
import { useSkin } from '../lib/theme';
import { decorSvgs } from '../styles/skins';

/**
 * The skin's decor, drawn inside the panel under every screen: a repeating background pattern,
 * a flourish along the top edge and an ornament in each corner, all from SVGs in
 * `styles/skins/decor/` that use `currentColor`, so the skin's ink tints them at the skin's
 * opacity. Mounted by the shell before the screens; nothing here takes a touch. Settings ›
 * Appearance passes `skin` to draw another skin's decor in its previews.
 */
export function SkinDecor({ skin: shown }: { skin?: Skin } = {}) {
  const { skin: current } = useSkin();
  const skin = shown ?? current;
  const decor = skin.decor;
  if (!decor) return null;
  const bg = decor.background ? decorSvgs[decor.background] : undefined;
  const header = decor.header ? decorSvgs[decor.header] : undefined;
  const corner = decor.corners ? decorSvgs[decor.corners] : undefined;
  if (!bg && !header && !corner) return null;
  return (
    <div
      className="skin-decor"
      aria-hidden="true"
      data-decor={skin.id}
      style={{ '--decor-opacity': decor.opacity } as CSSProperties}
    >
      {bg && <div className="decor-bg" dangerouslySetInnerHTML={{ __html: bg }} />}
      {header && <div className="decor-header" dangerouslySetInnerHTML={{ __html: header }} />}
      {corner &&
        ['tl', 'tr', 'bl', 'br'].map((pos) => (
          <div
            key={pos}
            className={`decor-corner ${pos}`}
            dangerouslySetInnerHTML={{ __html: corner }}
          />
        ))}
    </div>
  );
}
