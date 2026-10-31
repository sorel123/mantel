import type { Appearance, Layout, Settings } from '@mantel/shared';
import { Field, Section, Seg } from './controls';

/**
 * What the Appearance and Layout pages show until workstreams E and F land their sections:
 * the settings fields that exist in the schema today, edited directly. E and F replace these
 * by exporting `AppearanceSection` and `LayoutSection` from their folders (see Optional.tsx).
 */

export function AppearanceFallback({
  value,
  theme,
  onChange,
  onTheme,
}: {
  value: Appearance;
  theme: Settings['theme'];
  onChange: (v: Appearance) => void;
  onTheme: (t: Settings['theme']) => void;
}) {
  return (
    <Section
      id="appearance"
      title="Appearance"
      hint="Skins with Daylight and Dusk versions arrive with the skins update; the basics are here now."
    >
      <Field label="Look" hint="Auto uses Dusk from evening until morning (or sunset to sunrise).">
        <Seg
          label="Look"
          value={theme}
          options={[
            ['auto', 'Auto'],
            ['daylight', 'Daylight'],
            ['dusk', 'Dusk'],
          ]}
          onChange={onTheme}
        />
      </Field>
      <Field label="Text size" hint="Large is easier to read from across the room.">
        <Seg
          label="Text size"
          value={value.textSize}
          options={[
            ['compact', 'Compact'],
            ['default', 'Default'],
            ['large', 'Large'],
          ]}
          onChange={(textSize) => onChange({ ...value, textSize })}
        />
      </Field>
      <Field label="Follow the season" hint="Switch to a seasonal skin by date, once skins are in.">
        <button
          type="button"
          role="switch"
          aria-checked={value.followSeason}
          aria-label="Follow the season"
          className={`sw${value.followSeason ? ' on' : ''}`}
          onClick={() => onChange({ ...value, followSeason: !value.followSeason })}
        />
      </Field>
    </Section>
  );
}

export function LayoutFallback({
  value,
  onChange,
}: {
  value: Layout;
  onChange: (v: Layout) => void;
}) {
  const pct = Math.round(value.scale * 100);
  return (
    <Section
      id="layout"
      title="Layout"
      hint="Presets per screen arrive with the layouts update. Screen fit is here now."
    >
      <Field
        label="Screen fit"
        hint="Fit keeps the panel's shape and letterboxes. Fill stretches to the edges. Scale sets a size by hand."
      >
        <Seg
          label="Screen fit"
          value={value.fit}
          options={[
            ['fit', 'Fit'],
            ['fill', 'Fill'],
            ['scale', 'Scale'],
          ]}
          onChange={(fit) => onChange({ ...value, fit })}
        />
      </Field>
      {value.fit === 'scale' && (
        <div className="set-field">
          <span className="set-label">
            Scale
            <span className="set-hint">90% to 130% of the standard panel.</span>
          </span>
          <span className="set-pair grow">
            <input
              className="set-range"
              type="range"
              min={90}
              max={130}
              step={5}
              aria-label="Scale"
              value={pct}
              style={{ '--v': `${((pct - 90) / 40) * 100}%` } as React.CSSProperties}
              onChange={(e) => onChange({ ...value, scale: e.target.valueAsNumber / 100 })}
            />
            <span className="set-num tnum">{pct}%</span>
          </span>
        </div>
      )}
    </Section>
  );
}
