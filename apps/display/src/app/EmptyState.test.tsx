import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmptyIcon, EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('shows the line and a button that opens the Settings section', () => {
    render(
      <EmptyState icon={EmptyIcon.calendar} action="Connect a calendar" section="calendars">
        No calendars connected yet.
      </EmptyState>,
    );
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('No calendars connected yet.');
    expect(status.querySelector('svg')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Connect a calendar' }).getAttribute('href')).toBe(
      '/settings#calendars',
    );
  });

  it('can be just a line', () => {
    render(<EmptyState compact>Nothing planned.</EmptyState>);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('status').className).toBe('empty state compact');
  });
});
