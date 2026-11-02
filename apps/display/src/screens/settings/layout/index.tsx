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
  TODAY_ROWS,
  type Fit,
  type DockDate,
  type LayoutSettings,
  type MonthDensity,
  type MonthPreset,
  type PresetInfo,
  type TodayPreset,
  type TodayRow,
} from '@mantel/shared';
import type { ComponentType, CSSProperties } from 'react';
import { openPreview } from '../../../lib/preview';
import { Field, Section, Seg } from '../controls';
import { CardEditor } from './CardEditor';
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
      {value.todayPreset === 'custom' && <CardEditor layout={value} onChange={onChange} />}
      {(value.todayPreset === 'agenda' ||
        value.todayPreset === 'photo' ||
        (value.todayPreset === 'custom' &&
          value.todayCards.some((c) => c.kind === 'agenda' && c.w >= 5 && c.h >= 6))) && (
        <RowsPicker
          value={value.todayRows ?? ['tonight', 'week']}
          onChange={(todayRows) => onChange({ ...value, todayRows })}
        />
      )}
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
      <Field
        label="Date in the dock"
        hint="The day or the date beside the clock at the bottom of the screen."
      >
        <Seg<DockDate>
          label="Date in the dock"
          value={value.dockDate ?? 'off'}
          options={[
            ['off', 'Off'],
            ['day', 'Day (Sun 2)'],
            ['date', 'Date (Sun, Nov 2)'],
          ]}
          onChange={(dockDate) => onChange({ ...value, dockDate })}
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

/**
 * The rows under today's agenda, in order: each chosen row with up, down and remove, and the
 * rest as chips to add. The last stretchy row (photo, next days, list) takes the spare room.
 */
function RowsPicker({ value, onChange }: { value: TodayRow[]; onChange: (v: TodayRow[]) => void }) {
  const name = (id: TodayRow) => TODAY_ROWS.find((r) => r.id === id)?.name ?? id;
  const move = (i: number, by: number) => {
    const next = [...value];
    const [r] = next.splice(i, 1);
    next.splice(i + by, 0, r!);
    onChange(next);
  };
  const unused = TODAY_ROWS.filter((r) => !value.includes(r.id));
  return (
    <div className="set-sub">
      <div className="set-label">
        Under today&rsquo;s agenda
        <span className="set-hint">
          Rows below the day&rsquo;s events, top to bottom. The events take only the room they need;
          a photo, the next days or a list fills the rest.
        </span>
      </div>
      <ol className="lay-rows" aria-label="Rows under the agenda">
        {value.map((id, i) => (
          <li key={id}>
            <b>{name(id)}</b>
            <button
              type="button"
              className="set-btn quiet"
              aria-label={`Move ${name(id)} up`}
              disabled={i === 0}
              onClick={() => move(i, -1)}
            >
              ↑
            </button>
            <button
              type="button"
              className="set-btn quiet"
              aria-label={`Move ${name(id)} down`}
              disabled={i === value.length - 1}
              onClick={() => move(i, 1)}
            >
              ↓
            </button>
            <button
              type="button"
              className="set-btn quiet"
              aria-label={`Remove ${name(id)}`}
              onClick={() => onChange(value.filter((r) => r !== id))}
            >
              Remove
            </button>
          </li>
        ))}
        {value.length === 0 && <li className="none">Just the day&rsquo;s events.</li>}
      </ol>
      {unused.length > 0 && (
        <div className="lay-addrow" role="group" aria-label="Add a row">
          {unused.map((r) => (
            <button
              key={r.id}
              type="button"
              className="set-btn"
              title={r.description}
              onClick={() => onChange([...value, r.id])}
            >
              + {r.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
