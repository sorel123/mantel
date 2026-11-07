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
