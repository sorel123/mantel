import type { HomeEntity } from '@mantel/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useServerEvent } from '../../lib/events';
import { hsCss, isOn, kelvinRange, kelvinToRgb, lightCaps, lightCss, toPct } from './format';
import type { CallFn } from './useHome';

/** Colour swatches: full colours round the wheel, then softer versions of a few. */
const COLORS: Array<[number, number]> = [
  [0, 100],
  [25, 100],
  [45, 100],
  [60, 100],
  [100, 100],
  [150, 100],
  [185, 100],
  [215, 100],
  [250, 100],
  [280, 100],
  [310, 100],
  [335, 100],
  [0, 45],
  [30, 45],
  [55, 40],
  [130, 40],
  [200, 40],
  [265, 40],
];

const WHITES: Array<[string, number]> = [
  ['Candle', 2200],
  ['Warm', 2700],
  ['Soft', 3000],
  ['Neutral', 4000],
  ['Daylight', 5000],
  ['Cool', 6500],
];

const SETTLE_MS = 250;
const rgbCss = (rgb: [number, number, number]) => `rgb(${rgb.join(' ')})`;

/**
 * The colour sheet for one light: brightness, colour swatches and a hue slider, and whites from
 * candle to cool with a temperature slider. Follows the light's state while it is open, so a
 * change made in Home Assistant or a scene shows here too.
 */
export function LightColorSheet({ entity, call }: { entity: HomeEntity; call: CallFn }) {
  const [e, setE] = useState(entity);
  useServerEvent(
    'home.state',
    useCallback(
      (p: { entity: HomeEntity }) => {
        if (p.entity.id === entity.id) setE(p.entity);
      },
      [entity.id],
    ),
  );
  const caps = lightCaps(e);
  const [lo, hi] = kelvinRange(e);
  const whites = WHITES.filter(([, k]) => k >= lo - 100 && k <= hi + 100).map(
    ([name, k]) => [name, Math.min(hi, Math.max(lo, k))] as const,
  );
  const on = isOn(e);
  const pct = toPct(e.attrs.brightness) ?? 0;
  const hs = Array.isArray(e.attrs.hs_color) ? (e.attrs.hs_color as number[]) : null;
  const kelvin = Number(e.attrs.color_temp_kelvin) || null;
  const mode = typeof e.attrs.color_mode === 'string' ? e.attrs.color_mode : '';
  const showingWhite = mode === 'color_temp' || (!hs && kelvin !== null);

  // Sliders send once the finger settles; swatches send straight away.
  const [hue, setHue] = useState<number | null>(null);
  const [temp, setTemp] = useState<number | null>(null);
  const [bri, setBri] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const send = (data: Record<string, unknown>, attrs: Record<string, unknown>) => {
    const next = { ...e, state: 'on', attrs: { ...e.attrs, ...attrs } };
    setE(next);
    return call(e, 'turn_on', data, { state: 'on', attrs });
  };
  const later = (fn: () => Promise<unknown>, done: () => void) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void fn().finally(done), SETTLE_MS);
  };

  const pickColor = (h: number, s: number) =>
    send(
      { hs_color: [h, s] },
      { color_mode: 'hs', hs_color: [h, s], rgb_color: null, color_temp_kelvin: null },
    );
  const pickWhite = (k: number) =>
    send(
      { color_temp_kelvin: k },
      { color_mode: 'color_temp', color_temp_kelvin: k, rgb_color: null, hs_color: null },
    );

  const hueValue = hue ?? (hs ? Math.round(hs[0] ?? 0) : 0);
  const tempValue = temp ?? kelvin ?? Math.round((lo + hi) / 2);
  const briValue = bri ?? (on ? pct : 0);
  const current = lightCss(e);

  return (
    <div className="hm-color">
      <div className="hm-color-top">
        <span
          className={`hm-color-glow${on ? '' : ' off'}`}
          style={{ '--glow': current ?? 'var(--surface-2)' } as React.CSSProperties}
          aria-hidden="true"
        />
        <button
          type="button"
          className={`hm-color-power${on ? ' on' : ''}`}
          aria-pressed={on}
          onClick={() =>
            on
              ? void call(e, 'turn_off', undefined, {
                  state: 'off',
                  attrs: { brightness: null },
                }).then(() => setE((x) => ({ ...x, state: 'off' })))
              : void send({}, {})
          }
        >
          {on ? 'Turn off' : 'Turn on'}
        </button>
      </div>

      <label className="hm-color-row">
        <span>Brightness</span>
        <input
          className="hm-bri big"
          type="range"
          min={1}
          max={100}
          value={Math.max(1, briValue)}
          style={{ '--v': `${briValue}%` } as React.CSSProperties}
          aria-label={`${e.name} brightness`}
          onChange={(ev) => {
            const v = Number(ev.target.value);
            setBri(v);
            later(
              () => send({ brightness_pct: v }, { brightness: Math.round(v * 2.55) }),
              () => setBri(null),
            );
          }}
        />
      </label>

      {caps.color && (
        <section aria-label="Colours">
          <h3 className="eyebrow">Colour</h3>
          <div className="hm-swatches">
            {COLORS.map(([h, s]) => {
              const chosen =
                !showingWhite &&
                hs &&
                Math.abs((hs[0] ?? -99) - h) < 4 &&
                Math.abs((hs[1] ?? 0) - s) < 6;
              return (
                <button
                  key={`${h}-${s}`}
                  type="button"
                  className={`hm-swatch${chosen ? ' on' : ''}`}
                  style={{ background: hsCss(h, s) }}
                  aria-label={`Colour, hue ${h}${s < 100 ? ', soft' : ''}`}
                  aria-pressed={!!chosen}
                  onClick={() => void pickColor(h, s)}
                />
              );
            })}
          </div>
          <input
            className="hm-hue"
            type="range"
            min={0}
            max={359}
            value={hueValue}
            aria-label="Hue"
            style={{ '--thumb': hsCss(hueValue, 100) } as React.CSSProperties}
            onChange={(ev) => {
              const h = Number(ev.target.value);
              setHue(h);
              later(
                () => pickColor(h, hs && !showingWhite ? (hs[1] ?? 100) : 100),
                () => setHue(null),
              );
            }}
          />
        </section>
      )}

      {caps.white && (
        <section aria-label="Whites">
          <h3 className="eyebrow">White</h3>
          <div className="hm-whites">
            {whites.map(([name, k]) => {
              const chosen = showingWhite && kelvin !== null && Math.abs(kelvin - k) < 150;
              return (
                <button
                  key={name}
                  type="button"
                  className={`hm-white${chosen ? ' on' : ''}`}
                  aria-pressed={chosen}
                  onClick={() => void pickWhite(k)}
                >
                  <i style={{ background: rgbCss(kelvinToRgb(k)) }} />
                  <span>{name}</span>
                </button>
              );
            })}
          </div>
          <input
            className="hm-kelvin"
            type="range"
            min={lo}
            max={hi}
            step={50}
            value={tempValue}
            aria-label="Colour temperature"
            style={
              {
                '--warm': rgbCss(kelvinToRgb(lo)),
                '--cool': rgbCss(kelvinToRgb(hi)),
              } as React.CSSProperties
            }
            onChange={(ev) => {
              const k = Number(ev.target.value);
              setTemp(k);
              later(
                () => pickWhite(k),
                () => setTemp(null),
              );
            }}
          />
        </section>
      )}
    </div>
  );
}
