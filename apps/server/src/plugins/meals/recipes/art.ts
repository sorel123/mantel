/**
 * Mock mode's recipe photos: a plate seen from above on a coloured table, drawn as SVG from the
 * fixture's palette, so the grid looks like a recipe box with no network and no stock photos.
 */
import { recipeArt, type RecipeArt } from '@mantel/shared/fixtures';

const FALLBACK: RecipeArt = {
  table: '#D9CBB8',
  plate: '#FAF6EF',
  base: '#E0A458',
  garnish: ['#B4462F', '#5D8C3E'],
  shape: 'plate',
};

/** Small deterministic scatter so each picture looks hand-placed. */
function rng(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function bits(
  r: () => number,
  n: number,
  cx: number,
  cy: number,
  rad: number,
  fill: string,
  size: number,
) {
  let out = '';
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * rad;
    const x = cx + Math.cos(a) * d;
    const y = cy + Math.sin(a) * d;
    const s = size * (0.6 + r() * 0.8);
    out += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${s.toFixed(1)}" ry="${(s * 0.7).toFixed(1)}" transform="rotate(${Math.round(r() * 180)} ${x.toFixed(1)} ${y.toFixed(1)})" fill="${fill}"/>`;
  }
  return out;
}

function food(a: RecipeArt, r: () => number): string {
  const [g1, g2] = a.garnish;
  switch (a.shape) {
    case 'bowl':
      return `<circle cx="400" cy="300" r="190" fill="${a.plate}"/>
<circle cx="400" cy="300" r="150" fill="${a.base}"/>
<circle cx="400" cy="300" r="150" fill="url(#shine)"/>
<path d="M330 290 q70 -40 140 0" stroke="${g1}" stroke-width="10" fill="none" stroke-linecap="round" opacity=".85"/>
${bits(r, 9, 400, 300, 110, g2, 14)}`;
    case 'stack':
      return `<circle cx="400" cy="300" r="210" fill="${a.plate}"/>
${[0, 1, 2, 3]
  .map(
    (i) =>
      `<ellipse cx="${400 + i * 3}" cy="${330 - i * 22}" rx="150" ry="120" fill="${a.base}" stroke="#00000018" stroke-width="4"/>`,
  )
  .join('')}
<ellipse cx="410" cy="250" rx="70" ry="45" fill="${g2}" opacity=".9"/>
${bits(r, 10, 410, 260, 95, g1, 13)}`;
    case 'loaf':
      return `<rect x="170" y="140" width="460" height="320" rx="40" fill="${a.plate}"/>
<rect x="210" y="185" width="380" height="230" rx="70" fill="${a.base}"/>
<path d="M260 300 q140 -90 280 0" stroke="${g2}" stroke-width="16" fill="none" stroke-linecap="round" opacity=".7"/>
${bits(r, 7, 400, 300, 120, g1, 12)}`;
    case 'cookies': {
      let out = `<circle cx="400" cy="300" r="220" fill="${a.plate}"/>`;
      const spots: Array<[number, number]> = [
        [320, 230],
        [480, 230],
        [300, 370],
        [470, 380],
        [395, 300],
      ];
      for (const [x, y] of spots)
        out += `<circle cx="${x}" cy="${y}" r="70" fill="${a.base}"/><circle cx="${x}" cy="${y}" r="70" fill="url(#shine)"/>${bits(r, 6, x, y, 45, g1, 10)}`;
      return out;
    }
    case 'tacos':
      return `<rect x="140" y="150" width="520" height="300" rx="150" fill="${a.plate}"/>
${[0, 1, 2]
  .map((i) => {
    const x = 250 + i * 150;
    return `<path d="M${x - 75} 330 a75 75 0 0 1 150 0 z" fill="${a.base}" stroke="#00000014" stroke-width="4"/>
<path d="M${x - 58} 322 a58 52 0 0 1 116 0 z" fill="${g1}"/>
${bits(r, 6, x, 300, 40, g2, 10)}${bits(r, 4, x, 305, 35, '#F4D35E', 7)}`;
  })
  .join('')}`;
    default:
      return `<circle cx="400" cy="300" r="215" fill="${a.plate}"/>
<circle cx="400" cy="300" r="215" fill="none" stroke="#00000010" stroke-width="18"/>
<ellipse cx="380" cy="300" rx="130" ry="105" fill="${a.base}"/>
<ellipse cx="380" cy="300" rx="130" ry="105" fill="url(#shine)"/>
${bits(r, 14, 380, 300, 110, g1, 15)}${bits(r, 10, 470, 330, 70, g2, 12)}`;
  }
}

/** An 800 by 600 SVG photo for a mock recipe (or any seed). */
export function recipeArtSvg(id: string): string {
  const a = recipeArt(id) ?? FALLBACK;
  const r = rng(id);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600">
<defs>
<radialGradient id="light" cx="30%" cy="20%" r="90%"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#000" stop-opacity=".18"/></radialGradient>
<radialGradient id="shine" cx="35%" cy="30%" r="70%"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#000" flood-opacity=".25"/></filter>
</defs>
<rect width="800" height="600" fill="${a.table}"/>
<rect width="800" height="600" fill="url(#light)"/>
<g opacity=".08" stroke="#000" stroke-width="2">${Array.from({ length: 12 }, (_, i) => `<line x1="0" y1="${i * 50 + 25}" x2="800" y2="${i * 50 + 10}"/>`).join('')}</g>
<rect x="610" y="420" width="170" height="160" rx="16" fill="#ffffff" opacity=".55" transform="rotate(-12 690 500)"/>
<g filter="url(#shadow)">${food(a, r)}</g>
<g transform="rotate(28 660 140)"><rect x="640" y="30" width="14" height="220" rx="7" fill="#C9CCD1"/><ellipse cx="647" cy="40" rx="18" ry="30" fill="#C9CCD1"/></g>
</svg>`;
}
