/**
 * Skins (workstream E). A skin is one JSON file: a name, a tag or two, a Daylight and a Dusk
 * set of the thirteen colours in `tokens.css`, two fonts from the bundled set, a radius scale,
 * a card style, twelve person colours and optional decor. The display applies it as CSS
 * variables; the Appearance settings pick one, override an accent or font, and can import or
 * export a custom one. `followSeason` swaps in a dated skin (Harvest in autumn, Lights in
 * December) on top of the chosen one.
 */
import { z } from 'zod';

// Local copy of models.ts's Color so this file does not import models (which imports Appearance).
const Color = z.string().min(1);

/** The thirteen colours a skin sets per mode, in the order they appear in `tokens.css`. */
export const SKIN_TOKEN_KEYS = [
  'bg',
  'surface',
  'surface2',
  'ink',
  'ink2',
  'ink3',
  'line',
  'accent',
  'accentSoft',
  'accentInk',
  'scrim',
  'warn',
  'good',
] as const;
export type SkinTokenKey = (typeof SKIN_TOKEN_KEYS)[number];

/** CSS variable name for each token key (`surface2` → `--surface-2`). */
export const SKIN_TOKEN_VARS: Record<SkinTokenKey, string> = {
  bg: '--bg',
  surface: '--surface',
  surface2: '--surface-2',
  ink: '--ink',
  ink2: '--ink-2',
  ink3: '--ink-3',
  line: '--line',
  accent: '--accent',
  accentSoft: '--accent-soft',
  accentInk: '--accent-ink',
  scrim: '--scrim',
  warn: '--warn',
  good: '--good',
};

export const SkinTokens = z.object({
  bg: Color,
  surface: Color,
  surface2: Color,
  ink: Color,
  ink2: Color,
  ink3: Color,
  line: Color,
  accent: Color,
  accentSoft: Color,
  accentInk: Color,
  scrim: Color,
  warn: Color,
  good: Color,
});
export type SkinTokens = z.infer<typeof SkinTokens>;

/** The bundled, self-hosted fonts (`apps/display/public/fonts`). */
export const FontId = z.enum(['fraunces', 'manrope', 'space-grotesk', 'lora', 'caveat', 'archivo']);
export type FontId = z.infer<typeof FontId>;

export interface FontInfo {
  name: string;
  /** The CSS `font-family` stack, with system fallbacks. */
  stack: string;
  kind: 'serif' | 'sans' | 'script';
  /** Suits headings; the others suit body text too. */
  displayOnly?: boolean;
}

export const FONTS: Record<FontId, FontInfo> = {
  fraunces: {
    name: 'Fraunces',
    stack: "'Fraunces', Georgia, 'Times New Roman', serif",
    kind: 'serif',
  },
  manrope: {
    name: 'Manrope',
    stack: "'Manrope', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif",
    kind: 'sans',
  },
  'space-grotesk': {
    name: 'Space Grotesk',
    stack: "'Space Grotesk', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif",
    kind: 'sans',
  },
  lora: { name: 'Lora', stack: "'Lora', Georgia, 'Times New Roman', serif", kind: 'serif' },
  caveat: {
    name: 'Caveat',
    stack: "'Caveat', 'Bradley Hand', 'Segoe Print', cursive",
    kind: 'script',
    displayOnly: true,
  },
  archivo: {
    name: 'Archivo',
    stack: "'Archivo', 'Arial Narrow', Impact, sans-serif",
    kind: 'sans',
  },
};

export const CardStyle = z.enum(['flat', 'outlined', 'elevated', 'paper']);
export type CardStyle = z.infer<typeof CardStyle>;

export const TypeStyle = z.enum(['default', 'heavy']);
export type TypeStyle = z.infer<typeof TypeStyle>;

/** Decor files are names of SVGs in `apps/display/src/styles/skins/decor/` (without `.svg`). */
export const SkinDecor = z.object({
  /** A repeating pattern or texture behind every screen. */
  background: z.string().optional(),
  /** A flourish along the top edge. */
  header: z.string().optional(),
  /** An ornament drawn in each corner. */
  corners: z.string().optional(),
  opacity: z.number().min(0).max(1).default(0.5),
});
export type SkinDecor = z.infer<typeof SkinDecor>;

export const MonthDay = z
  .string()
  .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'expected MM-DD');

/** When "Follow the season" picks this skin. A range may wrap the new year (`12-01` to `01-06`). */
export const SeasonRange = z.object({ from: MonthDay, to: MonthDay });
export type SeasonRange = z.infer<typeof SeasonRange>;

export const PersonColor = z.object({ name: z.string().min(1), color: Color });

export const Skin = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits and dashes'),
  name: z.string().min(1),
  description: z.string().optional(),
  /** Free text: a season (`fall`, `winter`) or a mood (`bold`, `quiet`). */
  tags: z.array(z.string()).default([]),
  daylight: SkinTokens,
  dusk: SkinTokens,
  fonts: z.object({ display: FontId, body: FontId }),
  /** Multiplies every radius in `tokens.css`: 0 is square, 1 the Mantel default. */
  radii: z.number().min(0).max(2).default(1),
  cardStyle: CardStyle.default('elevated'),
  /** `heavy` sets headlines in a wide, black weight with the big date in capitals (the flyer look). */
  type: TypeStyle.default('default'),
  /** Twelve named colours offered when a person is given a colour. */
  personPalette: z.array(PersonColor).length(12),
  decor: SkinDecor.optional(),
  season: SeasonRange.optional(),
});
export type Skin = z.infer<typeof Skin>;
export type SkinInput = z.input<typeof Skin>;

export const TextSize = z.enum(['compact', 'default', 'large']);
export type TextSize = z.infer<typeof TextSize>;
export const TEXT_SCALE: Record<TextSize, number> = { compact: 0.92, default: 1, large: 1.12 };

/** The id a custom (imported or hand-made) skin is stored under. */
export const CUSTOM_SKIN_ID = 'custom';

/**
 * The appearance settings. `skin` names a built-in skin or `custom`, in which case `custom`
 * holds the skin itself. `accent` and `displayFont` override the skin's own.
 */
export const Appearance = z.object({
  skin: z.string().default('mantel'),
  accent: Color.optional(),
  displayFont: FontId.optional(),
  textSize: TextSize.default('default'),
  followSeason: z.boolean().default(false),
  custom: Skin.optional(),
});
export type Appearance = z.infer<typeof Appearance>;

export const DEFAULT_APPEARANCE: Appearance = {
  skin: 'mantel',
  textSize: 'default',
  followSeason: false,
};

/* ---------- seasons ---------- */

const monthDay = (d: Date) =>
  `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Days from `from` to `to` inclusive, in a 366-day year, wrapping the new year. */
function rangeLength(range: SeasonRange): number {
  const day = (md: string) => {
    const [m, d] = md.split('-').map(Number) as [number, number];
    return m * 31 + d;
  };
  const a = day(range.from);
  const b = day(range.to);
  return b >= a ? b - a : 12 * 31 + 31 - a + b;
}

export function inSeason(range: SeasonRange, date: Date): boolean {
  const md = monthDay(date);
  if (range.from <= range.to) return md >= range.from && md <= range.to;
  return md >= range.from || md <= range.to;
}

/**
 * The seasonal skin for a date, if any: the dated skin whose range contains the date, the
 * shortest range winning (Harvest Night over Harvest in late October).
 */
export function seasonalSkin(skins: readonly Skin[], date = new Date()): Skin | undefined {
  const matches = skins.filter((s) => s.season && inSeason(s.season, date));
  matches.sort((a, b) => rangeLength(a.season!) - rangeLength(b.season!));
  return matches[0];
}

/* ---------- colours ---------- */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Parses `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()` and `rgba()`. Returns null for anything else. */
export function parseColor(input: string): Rgba | null {
  const s = input.trim().toLowerCase();
  const hex = s.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    let h = hex[1]!;
    if (h.length === 3 || h.length === 4)
      h = h
        .split('')
        .map((c) => c + c)
        .join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const n = parseInt(h, 16);
    const hasA = h.length === 8;
    return {
      r: (n >>> (hasA ? 24 : 16)) & 255,
      g: (n >>> (hasA ? 16 : 8)) & 255,
      b: (n >>> (hasA ? 8 : 0)) & 255,
      a: hasA ? (n & 255) / 255 : 1,
    };
  }
  const fn = s.match(
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+%?)\s*)?\)$/,
  );
  if (fn) {
    const a =
      fn[4] === undefined ? 1 : fn[4].endsWith('%') ? parseFloat(fn[4]) / 100 : parseFloat(fn[4]);
    return { r: +fn[1]!, g: +fn[2]!, b: +fn[3]!, a: Math.max(0, Math.min(1, a)) };
  }
  return null;
}

const hex2 = (n: number) =>
  Math.round(Math.max(0, Math.min(255, n)))
    .toString(16)
    .padStart(2, '0');

export function toHex({ r, g, b }: Rgba): string {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

export function toCss(c: Rgba): string {
  return c.a >= 1
    ? toHex(c)
    : `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${Math.round(c.a * 100) / 100})`;
}

/** `fg` composited over an opaque `bg`. */
export function composite(fg: Rgba, bg: Rgba): Rgba {
  const a = fg.a;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
}

/** Relative luminance (WCAG 2.x) of an opaque colour. */
export function luminance({ r, g, b }: Rgba): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio of `fg` on `bg`; a translucent `fg` is composited on `bg` first. */
export function contrastRatio(fg: string, bg: string): number {
  const f = parseColor(fg);
  const b = parseColor(bg);
  if (!f || !b) return 0;
  const over = composite(f, { ...b, a: 1 });
  const l1 = luminance(over);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Mix `a` towards `b` by `t` (0 keeps `a`, 1 gives `b`). */
export function mix(a: string, b: string, t: number): string {
  const x = parseColor(a);
  const y = parseColor(b);
  if (!x || !y) return a;
  return toHex({
    r: x.r + (y.r - x.r) * t,
    g: x.g + (y.g - x.g) * t,
    b: x.b + (y.b - x.b) * t,
    a: 1,
  });
}

export function withAlpha(color: string, alpha: number): string {
  const c = parseColor(color);
  return c ? toCss({ ...c, a: alpha }) : color;
}

/** True when a colour reads as dark (so light text goes on it). */
export function isDark(color: string): boolean {
  const c = parseColor(color);
  return c ? luminance(c) < 0.35 : false;
}

/** White or near-black, whichever contrasts more with `bg`. */
export function inkFor(bg: string): string {
  return contrastRatio('#ffffff', bg) >= contrastRatio('#14161b', bg) ? '#ffffff' : '#14161b';
}

/* ---------- derive a full token set from the eight colours that matter ---------- */

export const CoreColors = z.object({
  bg: Color,
  surface: Color,
  ink: Color,
  ink2: Color,
  accent: Color,
  accentInk: Color,
  warn: Color,
  good: Color,
});
export type CoreColors = z.infer<typeof CoreColors>;

export const CORE_COLOR_KEYS = Object.keys(CoreColors.shape) as Array<keyof CoreColors>;

/** Fills in surface-2, ink-3, line, accent-soft and scrim from the eight colours a person picks. */
export function deriveTokens(core: CoreColors): SkinTokens {
  const dark = isDark(core.bg);
  return {
    bg: core.bg,
    surface: core.surface,
    surface2: mix(core.surface, core.ink, dark ? 0.07 : 0.08),
    ink: core.ink,
    ink2: core.ink2,
    ink3: mix(core.ink2, core.surface, 0.38),
    line: withAlpha(core.ink, dark ? 0.1 : 0.09),
    accent: core.accent,
    accentSoft: withAlpha(core.accent, dark ? 0.16 : 0.12),
    accentInk: core.accentInk,
    scrim: dark ? 'rgba(0, 0, 0, 0.45)' : 'rgba(10, 12, 16, 0.28)',
    warn: core.warn,
    good: core.good,
  };
}

/** The eight core colours of a full token set (for editing an existing skin). */
export function coreOf(tokens: SkinTokens): CoreColors {
  const { bg, surface, ink, ink2, accent, accentInk, warn, good } = tokens;
  return { bg, surface, ink, ink2, accent, accentInk, warn, good };
}

/** A token set with the accent swapped and its soft and ink companions recomputed. */
export function withAccent(tokens: SkinTokens, accent: string): SkinTokens {
  return {
    ...tokens,
    accent,
    accentSoft: withAlpha(accent, isDark(tokens.bg) ? 0.16 : 0.12),
    accentInk: inkFor(accent),
  };
}

/* ---------- contrast check ---------- */

export interface ContrastIssue {
  mode: 'daylight' | 'dusk';
  pair: string;
  ratio: number;
  minimum: number;
}

/**
 * The pairs every skin must pass: body text on every surface at AA (4.5:1), secondary text on
 * the card surface at AA, button text on the accent at AA, the accent, warn and good colours as
 * large or decorative colour (3:1), and hint text at 2.5:1. CI runs this over every bundled skin.
 */
export const CONTRAST_RULES: Array<{ fg: SkinTokenKey; bg: SkinTokenKey; minimum: number }> = [
  { fg: 'ink', bg: 'bg', minimum: 4.5 },
  { fg: 'ink', bg: 'surface', minimum: 4.5 },
  { fg: 'ink', bg: 'surface2', minimum: 4.5 },
  { fg: 'ink2', bg: 'surface', minimum: 4.5 },
  { fg: 'ink2', bg: 'bg', minimum: 4.5 },
  // Hint text (eyebrows, faint labels) is small and decorative; the Mantel baseline sits at 2.8.
  { fg: 'ink3', bg: 'surface', minimum: 2.5 },
  { fg: 'accentInk', bg: 'accent', minimum: 4.5 },
  { fg: 'accent', bg: 'surface', minimum: 3 },
  { fg: 'accent', bg: 'bg', minimum: 3 },
  { fg: 'warn', bg: 'surface', minimum: 3 },
  { fg: 'good', bg: 'surface', minimum: 3 },
];

export function checkContrast(skin: Pick<Skin, 'daylight' | 'dusk'>): ContrastIssue[] {
  const issues: ContrastIssue[] = [];
  for (const mode of ['daylight', 'dusk'] as const) {
    const t = skin[mode];
    for (const rule of CONTRAST_RULES) {
      const ratio = contrastRatio(t[rule.fg], t[rule.bg]);
      if (ratio < rule.minimum)
        issues.push({
          mode,
          pair: `${rule.fg} on ${rule.bg}`,
          ratio: Math.round(ratio * 100) / 100,
          minimum: rule.minimum,
        });
    }
  }
  return issues;
}

/* ---------- resolving what to show ---------- */

/** The skin the appearance settings name, or `fallback` when it is unknown. */
export function pickSkin(
  appearance: Appearance,
  skins: readonly Skin[],
  fallback: Skin,
  date = new Date(),
): Skin {
  if (appearance.followSeason) {
    const seasonal = seasonalSkin(skins, date);
    if (seasonal) return seasonal;
  }
  if (appearance.skin === CUSTOM_SKIN_ID && appearance.custom) return appearance.custom;
  return skins.find((s) => s.id === appearance.skin) ?? fallback;
}

/** The skin with the appearance's accent and display font overrides applied. */
export function applyOverrides(skin: Skin, appearance: Appearance): Skin {
  let out = skin;
  if (appearance.accent && parseColor(appearance.accent)) {
    out = {
      ...out,
      daylight: withAccent(out.daylight, appearance.accent),
      dusk: withAccent(out.dusk, appearance.accent),
    };
  }
  if (appearance.displayFont)
    out = { ...out, fonts: { ...out.fonts, display: appearance.displayFont } };
  return out;
}
