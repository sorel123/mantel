/** The icons a plugin may name in its blocks (`icon: 'trash'`). Unknown names draw `info`. */
const PATHS: Record<string, string> = {
  trash:
    '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
  recycle:
    '<path d="M7 19H4.8a1.8 1.8 0 0 1-1.6-2.7L5 13"/><path d="M11 19h8.2a1.8 1.8 0 0 0 1.6-2.7L19 13"/><path d="m14 16-3 3 3 3"/><path d="M8.3 9.3 10.5 5.4a1.8 1.8 0 0 1 3.1 0L15 8"/><path d="m5 13-1-4 4 1"/><path d="m19 13 1-4-4 1"/>',
  leaf: '<path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14"/><path d="M5 19 13 11"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5"/><path d="M9 2h6"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  star: '<path d="m12 3 2.8 5.8 6.2.9-4.5 4.4 1 6.2L12 17.3l-5.5 3 1-6.2L3 9.7l6.2-.9z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  box: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
  // v4 G, the plugin pack.
  cake: '<path d="M4 21h16"/><path d="M5 21v-8h14v8"/><path d="M5 16c2 1.5 4.5 1.5 7 0s5-1.5 7 0"/><path d="M12 13V9"/><path d="M12 6.5c-.8-.8-.8-1.8 0-3 .8 1.2.8 2.2 0 3z"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  paw: '<circle cx="7" cy="10" r="1.8"/><circle cx="10.5" cy="6.5" r="1.8"/><circle cx="15" cy="6.5" r="1.8"/><circle cx="18" cy="10" r="1.8"/><path d="M8.5 17.5c0-2.5 1.6-4.5 3.5-4.5s3.5 2 3.5 4.5c0 1.6-1.5 2.5-3.5 2-2 .5-3.5-.4-3.5-2z"/>',
  vote: '<rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V5h8v6"/><path d="m10 8 1.5 1.5L14 7"/>',
  trophy:
    '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4"/><path d="M12 13v4M8 21h8M9 17h6v4H9z"/>',
  school: '<path d="M3 9l9-5 9 5-9 5z"/><path d="M7 11v5c3 2 7 2 10 0v-5"/><path d="M21 9v6"/>',
  lunch: '<path d="M4 13h16a8 8 0 0 1-16 0z"/><path d="M9 9c0-2 2-2 2-4M13 9c0-2 2-2 2-4"/>',
  house: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>',
  door: '<path d="M6 21V4h12v17"/><path d="M3 21h18"/><path d="M14.5 12.5v.5"/>',
  washer:
    '<rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="13" r="4.5"/><path d="M7 6.5h.5M10 6.5h.5"/>',
  bolt: '<path d="M13 3 5 14h6l-1 7 8-11h-6z"/>',
  sprout:
    '<path d="M12 21v-9"/><path d="M12 12c0-4-3-6-7-6 0 4 3 6 7 6z"/><path d="M12 14c0-4 3-7 7-7 0 4-3 7-7 7z"/>',
  pill: '<rect x="3" y="9" width="18" height="6" rx="3" transform="rotate(-45 12 12)"/><path d="m9.5 9.5 5 5"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  sunrise:
    '<path d="M7 17a5 5 0 0 1 10 0"/><path d="M3 21h18M12 3v6M9 6l3-3 3 3M4.5 13l1.5 1M19.5 13 18 14"/>',
  sunset:
    '<path d="M7 17a5 5 0 0 1 10 0"/><path d="M3 21h18M12 3v6M9 6l3 3 3-3M4.5 13l1.5 1M19.5 13 18 14"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  sparkle:
    '<path d="M12 3c.6 4.2 2.8 6.4 7 7-4.2.6-6.4 2.8-7 7-.6-4.2-2.8-6.4-7-7 4.2-.6 6.4-2.8 7-7z"/><path d="M19 3v3M17.5 4.5h3"/>',
  send: '<path d="M4 12 20 4l-6 16-3-7z"/><path d="m11 13 9-9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
};

export function PluginIcon({ name, className }: { name?: string | undefined; className?: string }) {
  const d = PATHS[name ?? 'info'] ?? PATHS.info!;
  return (
    <svg
      className={`pi${className ? ` ${className}` : ''}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: d }}
    />
  );
}
