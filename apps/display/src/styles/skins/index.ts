import { Skin } from '@mantel/shared';

/**
 * Every `*.json` in this folder is a skin. Adding one is adding a file: it is validated against
 * the schema here (a bad file fails at startup and in `pnpm test`), checked for contrast in
 * `skins.test.ts`, and appears in the Appearance settings and the `/demo/skins` gallery.
 */
const files = import.meta.glob<unknown>('./*.json', { eager: true, import: 'default' });

const ORDER = [
  'mantel',
  'slate',
  'paper',
  'midnight',
  'chalkboard',
  'poster',
  'harvest',
  'frost',
  'bloom',
  'shore',
  'harvest-night',
  'lights',
];

export const builtInSkins: Skin[] = Object.entries(files)
  .map(([path, raw]) => {
    const parsed = Skin.safeParse(raw);
    if (!parsed.success)
      throw new Error(
        `Skin ${path} is invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      );
    return parsed.data;
  })
  .sort((a, b) => {
    const ia = ORDER.indexOf(a.id);
    const ib = ORDER.indexOf(b.id);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.name.localeCompare(b.name);
  });

export const defaultSkin: Skin =
  builtInSkins.find((s) => s.id === 'mantel') ??
  (() => {
    throw new Error('the Mantel skin is missing');
  })();

export const findBuiltInSkin = (id: string) => builtInSkins.find((s) => s.id === id);

/** Decor SVG sources by name; each uses `currentColor` so the skin's ink tints it. */
const decorFiles = import.meta.glob<string>('./decor/*.svg', {
  eager: true,
  query: '?raw',
  import: 'default',
});
export const decorSvgs: Record<string, string> = Object.fromEntries(
  Object.entries(decorFiles).map(([path, svg]) => [path.replace(/^.*\/([^/]+)\.svg$/, '$1'), svg]),
);
