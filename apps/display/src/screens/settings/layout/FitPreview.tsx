import { DEFAULT_PANEL, type Fit } from '@mantel/shared';
import { fitPanel } from '../../../lib/fit';

const SCREENS: Array<{ name: string; width: number; height: number }> = [
  { name: 'iPad', width: 1180, height: 820 },
  { name: 'Surface', width: 1440, height: 960 },
  { name: '16:9 monitor', width: 1920, height: 1080 },
];

/**
 * Live preview of the fit: three known screens drawn to scale, the panel inside each, and an
 * "Aa" at the size type will come out. Updates as the mode and the slider change.
 */
export function FitPreview({ fit, scale }: { fit: Fit; scale: number }) {
  return (
    <div className="lay-preview" aria-label="Fit preview">
      {SCREENS.map((s) => {
        const f = fitPanel(DEFAULT_PANEL, s.width, s.height, { fit, scale });
        // Draw each screen 120 px wide; the panel's drawn size follows its share of the screen.
        const w = 120;
        const h = Math.round((w * s.height) / s.width);
        const pw = Math.round((f.width * f.scale * w) / s.width);
        const ph = Math.round((f.height * f.scale * h) / s.height);
        // Type size relative to the iPad at ×1, so the "Aa" shows what zoom does.
        const type = f.scale / (s.height / DEFAULT_PANEL.height);
        return (
          <figure key={s.name} className="lay-screen">
            <div className="scr" style={{ width: w, height: h }}>
              <div
                className="pnl"
                style={{ width: pw, height: ph }}
                data-testid={`fit-preview-${s.name}`}
                data-width={f.width}
                data-height={f.height}
              >
                <span style={{ fontSize: `${Math.round(18 * type)}px` }}>Aa</span>
              </div>
            </div>
            <figcaption>
              {s.name}
              <small className="tnum">
                {f.width} × {f.height} at {Math.round(f.scale * 100)}%
              </small>
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}
