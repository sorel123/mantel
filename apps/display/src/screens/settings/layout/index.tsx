/**
 * Settings › Layout (workstream F): the Today and Month presets, how the panel fits each
 * display, and the zoom. Mount it in the settings hub with the layout slice of the draft:
 * `<LayoutSection value={draft.layout} onChange={(v) => set('layout', v)} />`.
 */
import {
  FIT_MODES,
  MONTH_DENSITIES,
  MONTH_PRESETS,
  SCALE_MAX,
  SCALE_MIN,
  SCALE_STEP,
  TODAY_PRESETS,
  type Fit,
  type LayoutSettings,
  type MonthDensity,
  type MonthPreset,
  type PresetInfo,
  type TodayPreset,
} from '@mantel/shared';
import type { ComponentType, CSSProperties } from 'react';
import { openPreview } from '../../../lib/preview';
import { Field, Section, Seg } from '../controls';
import { FitPreview } from './FitPreview';
import { FitThumb, MonthThumb, TodayThumb } from './thumbs';
import './layout.css';

export function LayoutSection({
  value,
  onChange,
}: {
  value: LayoutSettings;
  onChange: (v: LayoutSettings) => void;
}) {
  const scale = clampScale(value.scale);
  const pct = Math.round(scale * 100);
  return (
    <Section
      title="Layout"
      hint="How the Today and Month screens arrange their cards, and how the panel fits each display."
    >
      <Picker<TodayPreset>
        label="Today screen"
        options={TODAY_PRESETS}
        value={value.todayPreset}
        Thumb={TodayThumb}
        onChange={(todayPreset) => onChange({ ...value, todayPreset })}
      />
      <Picker<MonthPreset>
        label="Month screen"
        options={MONTH_PRESETS}
        value={value.monthPreset}
        Thumb={MonthThumb}
        onChange={(monthPreset) => onChange({ ...value, monthPreset })}
      />
      <Field label="Month density" hint="Compact fits four or five events in each day.">
        <Seg<MonthDensity>
          label="Month density"
          value={value.monthDensity ?? 'roomy'}
          options={MONTH_DENSITIES.map((d) => [d.id, d.name])}
          onChange={(monthDensity) => onChange({ ...value, monthDensity })}
        />
      </Field>
      <Picker<Fit>
        label="Screen fit"
        options={FIT_MODES}
        value={value.fit}
        Thumb={FitThumb}
        onChange={(fit) => onChange({ ...value, fit })}
      />
      <Field
        label="Size"
        hint={
          value.fit === 'scale'
            ? 'Everything on the wall, bigger or smaller.'
            : 'Choose the Scale fit above to use this.'
        }
      >
        <span className="set-pair lay-scale">
          <input
            className="set-range"
            type="range"
            min={SCALE_MIN * 100}
            max={SCALE_MAX * 100}
            step={SCALE_STEP * 100}
            aria-label="Size"
            value={pct}
            disabled={value.fit !== 'scale'}
            style={
              {
                '--v': `${((pct - SCALE_MIN * 100) / ((SCALE_MAX - SCALE_MIN) * 100)) * 100}%`,
              } as CSSProperties
            }
            onChange={(e) => onChange({ ...value, scale: e.target.valueAsNumber / 100 })}
          />
          <span className="set-num tnum">{pct}%</span>
        </span>
      </Field>
      <div className="set-sub">
        <div className="set-label">
          Preview
          <span className="set-hint">
            Where the panel sits on each kind of screen, and how big the type comes out.
          </span>
        </div>
        <FitPreview fit={value.fit} scale={scale} />
        <div className="lay-wall">
          <button
            type="button"
            className="set-btn primary"
            onClick={() => openPreview({ layout: { ...value, scale }, screen: 'today' })}
          >
            Preview Today on the wall
          </button>
          <button
            type="button"
            className="set-btn"
            onClick={() => openPreview({ layout: { ...value, scale }, screen: 'month' })}
          >
            Preview Month
          </button>
          <span className="set-hint">
            Opens the real display in a new tab with this layout. Nothing is saved until you press
            Save.
          </span>
        </div>
      </div>
      <p className="set-hint lay-note">
        Every display uses this. To give one display its own fit or size, set it on that display
        under Displays, or add <code>?fit=fill</code>, <code>?fit=scale&amp;scale=1.1</code>,{' '}
        <code>?today=family</code> or <code>?month=week</code> to the address its kiosk opens.
      </p>
    </Section>
  );
}

const clampScale = (n: number) =>
  Number.isFinite(n) ? Math.min(SCALE_MAX, Math.max(SCALE_MIN, n)) : 1;

function Picker<T extends string>({
  label,
  options,
  value,
  Thumb,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<PresetInfo<T>>;
  value: T;
  Thumb: ComponentType<{ id: T }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="set-sub">
      <div className="set-label">{label}</div>
      <div className="lay-pick" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={o.id === value}
            className="lay-opt"
            onClick={() => onChange(o.id)}
          >
            <Thumb id={o.id} />
            <b>{o.name}</b>
            <span>{o.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
