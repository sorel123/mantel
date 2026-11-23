import type { InboxOriginalKind, InboxSource } from '@mantel/shared';

const PATHS: Record<string, string> = {
  email: 'M3 6h18v12H3z M3 7l9 6 9-6',
  share: 'M12 3v12 M7 8l5-5 5 5 M5 13v7h14v-7',
  photo: 'M4 8h3l2-3h6l2 3h3v11H4z M12 10.5a3 3 0 1 1 0 6 3 3 0 0 1 0-6',
  text: 'M5 4h14v16H5z M8 9h8 M8 13h8 M8 17h5',
  pdf: 'M6 3h9l4 4v14H6z M15 3v4h4 M9 13h6 M9 17h4',
  ics: 'M4 6h16v14H4z M4 10h16 M8 3v4 M16 3v4 M9 15l2 2 4-4',
};

/** Where an item came from, as a small round icon (a PDF or calendar file shows its kind). */
export function SourceIcon({ source, kind }: { source: InboxSource; kind: InboxOriginalKind }) {
  const name = kind === 'pdf' || kind === 'ics' ? kind : source;
  return (
    <span className={`ibx-icon ${name}`} aria-hidden="true">
      <svg viewBox="0 0 24 24">
        {PATHS[name]!.split(' M').map((d, i) => (
          <path key={i} d={i ? `M${d}` : d} />
        ))}
      </svg>
    </span>
  );
}
