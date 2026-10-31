import type { ReactNode } from 'react';

/**
 * What a card or screen shows while its data source is not set up yet: one line, an optional
 * icon, and a button that opens the matching Settings section (`/settings#<section>`). Keep the
 * line short and plain ("No calendars connected yet."); the button says what the person will do
 * there ("Connect a calendar"). Styles: `.empty.state` in `ui.css`.
 */
export function EmptyState({
  children,
  icon,
  action,
  section,
  compact = false,
  className,
}: {
  /** The one line. */
  children: ReactNode;
  icon?: ReactNode;
  /** Button label; omit for a line with no button. */
  action?: string;
  /** Settings section the button opens, e.g. `calendars` for `/settings#calendars`. */
  section?: string;
  /** Tighter padding for a slot inside a card. */
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={['empty', 'state', compact && 'compact', className].filter(Boolean).join(' ')}
      role="status"
    >
      {icon && (
        <span className="empty-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <p className="empty-line">{children}</p>
      {action && (
        <a className="btn sm primary" href={`/settings#${section ?? ''}`}>
          {action}
        </a>
      )}
    </div>
  );
}

/** Small outline icons for empty states; 24-box, stroked with the current colour. */
export const EmptyIcon = {
  calendar: (
    <svg viewBox="0 0 24 24">
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  ),
  weather: (
    <svg viewBox="0 0 24 24">
      <path d="M7 18a4 4 0 0 1-.6-7.95A6 6 0 0 1 18 9.5 3.5 3.5 0 0 1 17.5 18z" />
    </svg>
  ),
  list: (
    <svg viewBox="0 0 24 24">
      <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
    </svg>
  ),
  home: (
    <svg viewBox="0 0 24 24">
      <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
    </svg>
  ),
};
