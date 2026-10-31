import {
  CORE_COLOR_KEYS,
  CardStyle,
  FONTS,
  FontId,
  checkContrast,
  coreOf,
  deriveTokens,
  parseColor,
  toHex,
  type CoreColors,
  type Skin,
} from '@mantel/shared';
import { useMemo, useState } from 'react';
import type { Mode } from '../../../lib/theme';
import { Field, Seg, TextInput } from '../controls';
import { SkinTile } from './SkinTile';

const CORE_LABELS: Record<keyof CoreColors, string> = {
  bg: 'Background',
  surface: 'Cards',
  ink: 'Text',
  ink2: 'Secondary text',
  accent: 'Accent',
  accentInk: 'Text on accent',
  warn: 'Warning',
  good: 'Good',
};

const PAIR_WORDS: Record<string, string> = {
  'ink on bg': 'Text on the background',
  'ink on surface': 'Text on cards',
  'ink on surface2': 'Text on inset cards',
  'ink2 on surface': 'Secondary text on cards',
  'ink2 on bg': 'Secondary text on the background',
  'ink3 on surface': 'Hint text on cards',
  'accentInk on accent': 'Text on the accent',
  'accent on surface': 'The accent on cards',
  'accent on bg': 'The accent on the background',
  'warn on surface': 'The warning colour on cards',
  'good on surface': 'The good colour on cards',
};

/** A colour as `#rrggbb` for `<input type="color">`, which accepts nothing else. */
const hexOf = (c: string) => {
  const p = parseColor(c);
  return p ? toHex(p) : '#000000';
};

/**
 * "Create your own": the eight colours that matter for each mode, a name, the fonts and the
 * card style; everything else is derived. Built on top of a starting skin so the person
 * palette and decor carry over.
 */
export function CustomSkinEditor({
  start,
  mode,
  onUse,
  onCancel,
}: {
  start: Skin;
  mode: Mode;
  onUse: (skin: Skin) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(start.id === 'custom' ? start.name : `My ${start.name}`);
  const [core, setCore] = useState<Record<Mode, CoreColors>>({
    daylight: coreOf(start.daylight),
    dusk: coreOf(start.dusk),
  });
  const [fonts, setFonts] = useState(start.fonts);
  const [cardStyle, setCardStyle] = useState(start.cardStyle);
  const [radii, setRadii] = useState(start.radii);
  const [editMode, setEditMode] = useState<Mode>(mode);

  const draft = useMemo<Skin>(
    () => ({
      ...start,
      id: 'custom',
      name: name.trim() || 'My skin',
      tags: ['custom'],
      daylight: deriveTokens(core.daylight),
      dusk: deriveTokens(core.dusk),
      fonts,
      cardStyle,
      radii,
      season: undefined,
    }),
    [start, name, core, fonts, cardStyle, radii],
  );
  const issues = useMemo(() => checkContrast(draft), [draft]);

  const setColor = (key: keyof CoreColors, value: string) =>
    setCore((c) => ({ ...c, [editMode]: { ...c[editMode], [key]: value } }));

  return (
    <div className="sk-editor">
      <div className="sk-editor-preview">
        <SkinTile skin={draft} mode="daylight" badge="Daylight" />
        <SkinTile skin={draft} mode="dusk" badge="Dusk" />
      </div>
      <Field label="Name">
        <TextInput label="Skin name" value={name} onChange={setName} maxLength={40} />
      </Field>
      <Field label="Colours for" hint="Each look has its own eight colours.">
        <Seg
          label="Edit colours for"
          value={editMode}
          options={[
            ['daylight', 'Daylight'],
            ['dusk', 'Dusk'],
          ]}
          onChange={setEditMode}
        />
      </Field>
      <div className="sk-colors" role="group" aria-label={`${editMode} colours`}>
        {CORE_COLOR_KEYS.map((key) => (
          <label key={key} className="sk-color">
            <input
              type="color"
              className="set-color"
              aria-label={`${CORE_LABELS[key]} (${editMode})`}
              value={hexOf(core[editMode][key])}
              onChange={(e) => setColor(key, e.target.value)}
            />
            <span>{CORE_LABELS[key]}</span>
          </label>
        ))}
      </div>
      <Field label="Headline font">
        <Seg
          label="Headline font"
          value={fonts.display}
          options={FontId.options.map((id) => [id, FONTS[id].name])}
          onChange={(display) => setFonts((f) => ({ ...f, display }))}
        />
      </Field>
      <Field label="Text font">
        <Seg
          label="Text font"
          value={fonts.body}
          options={FontId.options
            .filter((id) => !FONTS[id].displayOnly)
            .map((id) => [id, FONTS[id].name])}
          onChange={(body) => setFonts((f) => ({ ...f, body }))}
        />
      </Field>
      <Field label="Cards">
        <Seg
          label="Card style"
          value={cardStyle}
          options={CardStyle.options.map((c) => [c, c[0]!.toUpperCase() + c.slice(1)])}
          onChange={setCardStyle}
        />
      </Field>
      <Field label="Corners">
        <Seg
          label="Corners"
          value={radii <= 0.3 ? 'square' : radii >= 1.25 ? 'round' : 'soft'}
          options={[
            ['square', 'Square'],
            ['soft', 'Soft'],
            ['round', 'Round'],
          ]}
          onChange={(v) => setRadii(v === 'square' ? 0.15 : v === 'round' ? 1.4 : 1)}
        />
      </Field>
      {issues.length > 0 && (
        <ul className="sk-issues" aria-label="Contrast warnings">
          {issues.map((i) => (
            <li key={`${i.mode}-${i.pair}`}>
              {PAIR_WORDS[i.pair] ?? i.pair} is hard to read in{' '}
              {i.mode === 'dusk' ? 'Dusk' : 'Daylight'} ({i.ratio}:1, aim for {i.minimum}:1).
            </li>
          ))}
        </ul>
      )}
      <div className="sk-editor-actions">
        <button type="button" className="set-btn quiet" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="set-btn primary" onClick={() => onUse(draft)}>
          Use this skin
        </button>
      </div>
    </div>
  );
}
