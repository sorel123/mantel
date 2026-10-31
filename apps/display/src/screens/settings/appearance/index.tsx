import type { TextSize } from '@mantel/shared';
import {
  CUSTOM_SKIN_ID,
  FONTS,
  FontId,
  Skin,
  TEXT_SCALE,
  applyOverrides,
  checkContrast,
  parseColor,
  pickSkin,
  seasonalSkin,
  type Appearance,
} from '@mantel/shared';
import { useMemo, useRef, useState } from 'react';
import { openPreview } from '../../../lib/preview';
import type { Mode } from '../../../lib/theme';
import { builtInSkins, defaultSkin } from '../../../styles/skins';
import { Field, Section, Seg, Toggle } from '../controls';
import './appearance.css';
import { CustomSkinEditor } from './CustomSkinEditor';
import { LookPreview } from './LookPreview';
import { SkinTile } from './SkinTile';

/** Accents offered as one-tap swatches; the colour input takes anything else. */
const ACCENTS: Array<[string, string]> = [
  ['Green', '#246b5b'],
  ['Blue', '#2a5bd0'],
  ['Plum', '#7b3f8f'],
  ['Rose', '#b82f66'],
  ['Brick', '#b4481a'],
  ['Amber', '#c8761e'],
  ['Teal', '#0d7580'],
  ['Ink', '#1b1f27'],
];

const TEXT_SIZES: Array<[TextSize, string]> = [
  ['compact', 'Compact'],
  ['default', 'Default'],
  ['large', 'Large'],
];

/**
 * The Appearance section of Settings (workstream E): pick a skin from live tiles, follow the
 * season, override the accent and headline font, set the text size, import or export a skin as
 * JSON, or make your own from eight colours. `value` is the `settings.appearance` draft.
 */
export function AppearanceSection({
  value,
  onChange,
  mode = 'daylight',
  title = 'Appearance',
}: {
  value: Appearance;
  onChange: (next: Appearance) => void;
  /** Which look the tiles preview; defaults to Daylight. */
  mode?: Mode;
  title?: string;
}) {
  const [preview, setPreview] = useState<Mode>(mode);
  const [editing, setEditing] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const set = (patch: Partial<Appearance>) => onChange({ ...value, ...patch });
  const chosen = useMemo(
    () => pickSkin({ ...value, followSeason: false }, builtInSkins, defaultSkin),
    [value],
  );
  const seasonal = useMemo(() => seasonalSkin(builtInSkins), []);
  // What the wall would show: the season's skin when following it, with accent and font applied.
  const shown = useMemo(
    () => applyOverrides(value.followSeason && seasonal ? seasonal : chosen, value),
    [value, chosen, seasonal],
  );
  const tiles = value.custom ? [...builtInSkins, value.custom] : builtInSkins;

  const importSkin = (text: string) => {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      setImportError(
        "That isn't JSON. Export a skin from another Mantel, or start from a bundled one.",
      );
      return;
    }
    const parsed = Skin.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      setImportError(
        `Not quite a skin: ${issue.path.join('.') || 'the file'} ${issue.message.toLowerCase()}.`,
      );
      return;
    }
    const custom = { ...parsed.data, id: CUSTOM_SKIN_ID, season: undefined };
    const issues = checkContrast(custom);
    setImportError(
      issues.length
        ? `Imported, with ${issues.length} low-contrast pair${issues.length > 1 ? 's' : ''}; open Create your own to fix them.`
        : null,
    );
    set({ custom, skin: CUSTOM_SKIN_ID });
    setImportText('');
    setImportOpen(false);
  };

  const exportJson = JSON.stringify(
    chosen.id === CUSTOM_SKIN_ID
      ? chosen
      : { ...chosen, id: CUSTOM_SKIN_ID, name: `${chosen.name} copy` },
    null,
    2,
  );
  const copyExport = async () => {
    try {
      await navigator.clipboard.writeText(exportJson);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      download();
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([exportJson], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `mantel-skin-${chosen.id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <Section
      title={title}
      hint="How the wall looks: a skin, its accent, the headline font and the text size."
      action={
        <Seg
          label="Preview look"
          value={preview}
          options={[
            ['daylight', 'Daylight'],
            ['dusk', 'Dusk'],
          ]}
          onChange={setPreview}
        />
      }
    >
      <div className="set-sub wide">
        <LookPreview skin={shown} mode={preview} appearance={value} />
        <div className="sk-look-actions">
          <button
            type="button"
            className="set-btn primary"
            onClick={() => openPreview({ appearance: value, mode: preview, screen: 'today' })}
          >
            Preview on the wall
          </button>
          <span className="set-hint">
            Opens the real display in a new tab with these choices. Nothing is saved until you press
            Save.
          </span>
        </div>
      </div>

      <div className="sk-grid" role="radiogroup" aria-label="Skin">
        {tiles.map((skin) => (
          <SkinTile
            key={skin.id}
            skin={skin}
            mode={preview}
            selected={value.skin === skin.id}
            onSelect={() => set({ skin: skin.id })}
            badge={skin.id === CUSTOM_SKIN_ID ? 'Your own' : undefined}
          />
        ))}
      </div>

      <Toggle
        label="Follow the season"
        hint={
          seasonal
            ? `Today that is ${seasonal.name}. Outside a season the skin above shows.`
            : `Harvest in autumn, Frost in winter, Bloom in spring, Shore in summer, plus Halloween week and the holidays. Nothing is on today, so ${chosen.name} shows.`
        }
        checked={value.followSeason}
        onChange={(followSeason) => set({ followSeason })}
      />

      <Field
        label="Accent"
        hint="Buttons, highlights and the dock. Leave it to the skin or pick one."
      >
        <div className="sk-swatches" role="group" aria-label="Accent colour">
          <button
            type="button"
            className="sk-swatch own"
            aria-pressed={!value.accent}
            aria-label="Skin's own accent"
            onClick={() => set({ accent: undefined })}
          >
            Skin's
          </button>
          {ACCENTS.map(([name, color]) => (
            <button
              key={color}
              type="button"
              className="sk-swatch"
              aria-pressed={value.accent?.toLowerCase() === color}
              aria-label={`${name} accent`}
              style={{ background: color }}
              onClick={() => set({ accent: color })}
            />
          ))}
          <input
            type="color"
            className="set-color"
            aria-label="Any accent colour"
            value={value.accent && parseColor(value.accent) ? value.accent : chosen[preview].accent}
            onChange={(e) => set({ accent: e.target.value })}
          />
        </div>
      </Field>

      <Field label="Headline font" hint="Dates, titles and the big clock." stack>
        <div className="sk-faces" role="radiogroup" aria-label="Headline font">
          {[undefined, ...FontId.options].map((id) => {
            const face = FONTS[id ?? chosen.fonts.display];
            return (
              <button
                key={id ?? 'skin'}
                type="button"
                role="radio"
                aria-checked={value.displayFont === id}
                aria-label={id ? face.name : `Skin's own (${face.name})`}
                className="sk-face"
                onClick={() => set({ displayFont: id })}
              >
                <span className="big" style={{ fontFamily: face.stack }}>
                  {face.name}
                </span>
                <small>{id ? `${face.kind}` : "Skin's own"}</small>
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Text size" hint="Event titles, times and labels. The preview above follows.">
        <div className="sk-faces" role="radiogroup" aria-label="Text size">
          {TEXT_SIZES.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={value.textSize === id}
              aria-label={label}
              className="sk-face"
              onClick={() => set({ textSize: id })}
            >
              <span className="big" style={{ fontSize: 15 * TEXT_SCALE[id] }}>
                Leo soccer · 10:00
              </span>
              <small>{label}</small>
            </button>
          ))}
        </div>
      </Field>

      <div className="set-field sk-tools">
        <span className="set-label">
          Your own skin
          <span className="set-hint">
            Import a skin someone shared as JSON, export this one, or start from {chosen.name} and
            change the eight colours that matter.
          </span>
        </span>
        <div className="sk-tool-btns">
          <button type="button" className="set-btn" onClick={() => setImportOpen((v) => !v)}>
            Import
          </button>
          <button type="button" className="set-btn" onClick={copyExport}>
            {copied ? 'Copied' : 'Export'}
          </button>
          <button type="button" className="set-btn primary" onClick={() => setEditing(true)}>
            Create your own
          </button>
        </div>
      </div>

      {importOpen && (
        <div className="sk-import">
          <textarea
            className="set-input sk-import-text"
            aria-label="Skin JSON"
            placeholder='Paste a skin here ({ "id": …, "daylight": … })'
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
          />
          <div className="sk-tool-btns">
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) f.text().then(importSkin);
                e.target.value = '';
              }}
            />
            <button type="button" className="set-btn" onClick={() => fileInput.current?.click()}>
              Choose a file
            </button>
            <button
              type="button"
              className="set-btn primary"
              disabled={!importText.trim()}
              onClick={() => importSkin(importText)}
            >
              Import this
            </button>
          </div>
        </div>
      )}
      {importError && (
        <p className="set-err" role="status">
          {importError}
        </p>
      )}

      {editing && (
        <CustomSkinEditor
          start={chosen}
          mode={preview}
          onCancel={() => setEditing(false)}
          onUse={(custom) => {
            set({ custom, skin: CUSTOM_SKIN_ID });
            setEditing(false);
          }}
        />
      )}
    </Section>
  );
}
