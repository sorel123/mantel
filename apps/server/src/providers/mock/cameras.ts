/**
 * Generated camera pictures for mock mode: a still per camera and an animated "live" version
 * (SMIL runs inside `<img>`, scripts do not), so the snapshot tiles and the doorbell live view
 * can be demoed without a Ring account. 16:9 like the real feeds.
 */

const W = 640;
const H = 360;

interface Scene {
  sky: [string, string];
  ground: string;
  /** Static props, drawn over sky and ground. */
  props: string;
  /** Extra shapes that move in the live view. */
  live: string;
}

const scenes: Record<string, Scene> = {
  front_door: {
    sky: ['#3d4a5c', '#6b7a8c'],
    ground: '#4a4740',
    props: `
      <rect x="0" y="0" width="${W}" height="${H}" fill="#5b5f66"/>
      <rect x="230" y="40" width="180" height="270" rx="4" fill="#2c3440"/>
      <rect x="246" y="56" width="148" height="254" rx="2" fill="#7a2e2a"/>
      <rect x="262" y="76" width="52" height="96" rx="2" fill="#6a2724"/>
      <rect x="326" y="76" width="52" height="96" rx="2" fill="#6a2724"/>
      <rect x="262" y="190" width="52" height="100" rx="2" fill="#6a2724"/>
      <rect x="326" y="190" width="52" height="100" rx="2" fill="#6a2724"/>
      <circle cx="372" cy="186" r="6" fill="#c9a24a"/>
      <circle cx="320" cy="122" r="26" fill="none" stroke="#3f6b3a" stroke-width="12"/>
      <rect x="150" y="300" width="340" height="60" fill="#8a8172"/>
      <rect x="440" y="120" width="60" height="70" rx="6" fill="#e9d9a8" opacity=".85"/>`,
    live: `
      <g opacity=".92">
        <animateTransform attributeName="transform" type="translate" values="-160 0; 40 0; 40 0; -160 0" keyTimes="0; .35; .8; 1" dur="14s" repeatCount="indefinite"/>
        <ellipse cx="120" cy="352" rx="44" ry="8" fill="#000" opacity=".25"/>
        <rect x="92" y="208" width="56" height="144" rx="24" fill="#2b3a52"/>
        <circle cx="120" cy="186" r="26" fill="#d9a77f"/>
        <rect x="140" y="250" width="40" height="34" rx="4" fill="#b8865a"/>
      </g>`,
  },
  driveway: {
    sky: ['#58708c', '#a4b4c4'],
    ground: '#55565a',
    props: `
      <polygon points="180,${H} 300,160 360,160 520,${H}" fill="#6c6d70"/>
      <rect x="0" y="150" width="${W}" height="12" fill="#3d5a3a"/>
      <rect x="40" y="70" width="140" height="90" fill="#cfc6b4"/><polygon points="30,74 110,24 190,74" fill="#6a4a3a"/>
      <rect x="290" y="190" width="110" height="60" rx="14" fill="#2f4f7a"/>
      <rect x="302" y="172" width="84" height="32" rx="10" fill="#3a5f91"/>
      <circle cx="310" cy="252" r="12" fill="#1d1f22"/><circle cx="382" cy="252" r="12" fill="#1d1f22"/>`,
    live: `
      <g>
        <animateTransform attributeName="transform" type="translate" values="0 0; 8 -2; 0 0" dur="5s" repeatCount="indefinite"/>
        <circle cx="560" cy="110" r="44" fill="#3f6b3a"/><rect x="554" y="140" width="12" height="40" fill="#4d3a2a"/>
      </g>`,
  },
  backyard: {
    sky: ['#4f6f8f', '#9fc0d8'],
    ground: '#4c6b3c',
    props: `
      <rect x="0" y="180" width="${W}" height="10" fill="#7b6a52"/>
      ${Array.from({ length: 16 }, (_, i) => `<rect x="${i * 42}" y="150" width="30" height="40" fill="#8d7a5e"/>`).join('')}
      <rect x="400" y="230" width="150" height="80" rx="40" fill="#5a8fb0"/>
      <rect x="80" y="250" width="90" height="10" rx="4" fill="#3b3a36"/><rect x="90" y="260" width="8" height="40" fill="#3b3a36"/><rect x="152" y="260" width="8" height="40" fill="#3b3a36"/>`,
    live: `
      <g>
        <animateTransform attributeName="transform" type="rotate" values="-3 120 150; 3 120 150; -3 120 150" dur="4s" repeatCount="indefinite"/>
        <circle cx="120" cy="96" r="56" fill="#35602f"/><rect x="112" y="140" width="16" height="50" fill="#4d3a2a"/>
      </g>`,
  },
};

const fallback = scenes.driveway!;

const clock = (d: Date) =>
  d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** `camera.front_door` → the scene for `front_door`. */
export function cameraSvg(entityId: string, name: string, now: Date, live: boolean): string {
  const scene = scenes[entityId.split('.')[1] ?? ''] ?? fallback;
  const label = `${esc(name)} · ${clock(now)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${scene.sky[0]}"/><stop offset="1" stop-color="${scene.sky[1]}"/></linearGradient>
  <radialGradient id="vig" cx=".5" cy=".5" r=".75"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></radialGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  <rect y="${H * 0.55}" width="${W}" height="${H * 0.45}" fill="${scene.ground}"/>
  ${scene.props}
  ${live ? scene.live : ''}
  <rect width="${W}" height="${H}" fill="url(#vig)"/>
  <text x="16" y="${H - 16}" font-family="Menlo, monospace" font-size="15" fill="#fff" opacity=".85">${label}</text>
  ${
    live
      ? `<g><circle cx="${W - 64}" cy="24" r="6" fill="#e5484d"><animate attributeName="opacity" values="1;.2;1" dur="1.4s" repeatCount="indefinite"/></circle>
  <text x="${W - 50}" y="29" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="14" fill="#fff">LIVE</text></g>`
      : ''
  }
</svg>`;
}

/** Placeholder cover art for the mock Apple TV: a soft gradient tile with the title's initial. */
export function artworkSvg(title: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300" width="300" height="300">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7fb6e8"/><stop offset="1" stop-color="#3f7bd9"/></linearGradient></defs>
  <rect width="300" height="300" fill="url(#g)"/>
  <circle cx="220" cy="80" r="46" fill="#f4d58d" opacity=".9"/>
  <path d="M0 230 Q 80 180 160 220 T 300 210 V 300 H 0 Z" fill="#3ba06f"/>
  <text x="28" y="270" font-family="Georgia, serif" font-size="64" fill="#fff">${esc(title.slice(0, 1))}</text>
</svg>`;
}
