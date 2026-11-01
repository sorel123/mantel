import { addDays, atHour, startOfDay } from '@mantel/shared';
import { routeFixtures } from '@mantel/shared/fixtures';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OverlayProvider } from '../../app/overlay';
import { BootstrapProvider, useBootstrapState } from '../../lib/bootstrap';
import { MonthScreen, gridStart } from '../month';
import { countdownLabel, eventsOn, formatTime, relativeDay, resetCalendarCache } from './calendar';
import { TodayScreen } from './index';

const NOW = atHour(new Date(2026, 9, 30), 10.25);
const fixtures = routeFixtures(NOW);

const byPath: Record<string, unknown> = {
  '/bootstrap': fixtures.bootstrap,
  '/calendar': fixtures.calendar,
  '/countdowns': fixtures.countdowns,
  '/meals': fixtures.meals,
  '/weather': fixtures.weather,
  '/commute': fixtures.commute,
  '/lists': fixtures.lists,
};

type Call = { url: URL; method: string; body: unknown };
let calls: Call[];

function stubServer() {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input, 'http://wall');
      const method = init.method ?? 'GET';
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      const path = url.pathname.replace('/api', '');
      const reply =
        path === '/calendar/quick'
          ? { event: { ...fixtures.calendarQuick.event, title: body.title } }
          : path.startsWith('/calendar/events/')
            ? method === 'DELETE'
              ? { ok: true }
              : { event: { ...fixtures.calendarQuick.event, ...body } }
            : (byPath[path] ?? {});
      return new Response(JSON.stringify(reply), {
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
}

class FakeSocket {
  close() {}
}

function Ready({ children }: { children: React.ReactNode }) {
  const { state } = useBootstrapState();
  return state.status === 'ready' ? (
    <div className="panel">
      <OverlayProvider>{children}</OverlayProvider>
    </div>
  ) : null;
}
const mount = (ui: React.ReactNode) =>
  render(
    <BootstrapProvider>
      <Ready>{ui}</Ready>
    </BootstrapProvider>,
  );

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.stubGlobal('WebSocket', FakeSocket);
  resetCalendarCache();
  stubServer();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('formatting', () => {
  it('formats times and days like the mockup', () => {
    expect(formatTime(atHour(NOW, 7.5))).toBe('7:30 am');
    expect(formatTime(atHour(NOW, 15))).toBe('3 pm');
    expect(formatTime(atHour(NOW, 0), true)).toBe('12am');
    expect(relativeDay(NOW, NOW)).toBe('Today');
    expect(relativeDay(addDays(NOW, 1), NOW)).toBe('Tomorrow');
    expect(relativeDay(addDays(NOW, 3), NOW)).toBe('Monday');
    expect(relativeDay(addDays(NOW, 9), NOW)).toBe('Sun, Nov 8');
    expect(countdownLabel(0)).toBe('today');
    expect(countdownLabel(5)).toBe('5 days');
    expect(countdownLabel(18)).toBe('3 weeks');
  });

  it('puts all-day events first and keeps multi-day events on every day', () => {
    const today = startOfDay(NOW);
    const evs = eventsOn(fixtures.calendar.events, today);
    expect(evs[0]!.allDay).toBe(true);
    expect(evs.map((e) => e.title)).toContain('School drop-off');
    const span = { ...evs[0]!, end: addDays(today, 3).toISOString() };
    expect(eventsOn([span], addDays(today, 2))).toHaveLength(1);
    expect(eventsOn([span], addDays(today, 3))).toHaveLength(0);
  });

  it('starts the month grid on the Sunday before the 1st', () => {
    expect(gridStart(new Date(2026, 9, 1)).toDateString()).toBe(
      new Date(2026, 8, 27).toDateString(),
    );
  });
});

describe('Today', () => {
  it('shows the date, the timeline with the now line, countdowns, meals and the next three days', async () => {
    mount(<TodayScreen />);
    expect(await screen.findByText('School drop-off')).toBeTruthy();
    expect(screen.getByText('Friday')).toBeTruthy();
    expect(screen.getByText('Now · 10:15 am')).toBeTruthy();
    // Past events are dimmed; the band holds the all-day event.
    const rows = screen.getAllByTestId('event');
    expect(rows[0]!.className).toContain('past');
    expect(screen.getByText('Picture day').className).toContain('band');
    expect(await screen.findByText("Leo's birthday party")).toBeTruthy();
    expect(screen.getByText('2 days')).toBeTruthy();
    expect(await screen.findByText('Pizza Friday')).toBeTruthy();
    expect(screen.getByText('Tomorrow')).toBeTruthy();
    expect(screen.getByText(/Dentist/)).toBeTruthy();
    expect(await screen.findByText('Oat milk')).toBeTruthy();
    expect(await screen.findByLabelText(/^Weather/)).toBeTruthy();
    const q = calls.find((c) => c.url.pathname === '/api/calendar')!;
    expect(new Date(q.url.searchParams.get('from')!).getTime()).toBe(startOfDay(NOW).getTime());
  });

  it('opens quick add for today and posts the event', async () => {
    mount(<TodayScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add an event today' }));
    const sheet = await screen.findByRole('dialog');
    fireEvent.change(within(sheet).getByLabelText('Event title'), {
      target: { value: 'Pizza night' },
    });
    fireEvent.click(within(sheet).getByRole('button', { name: /Leo/ }));
    fireEvent.change(within(sheet).getByLabelText('Start time'), { target: { value: '18:30' } });
    await act(async () => {
      fireEvent.click(within(sheet).getByRole('button', { name: 'Add to calendar' }));
    });
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.url.pathname).toBe('/api/calendar/quick');
    expect(post.body).toMatchObject({ title: 'Pizza night', allDay: false, personIds: ['leo'] });
    const b = post.body as { start: string; end: string };
    expect(new Date(b.start).getTime()).toBe(atHour(NOW, 18.5).getTime());
    expect(new Date(b.end).getTime() - new Date(b.start).getTime()).toBe(3600e3);
  });
});

describe('Month', () => {
  it('renders the weeks the month needs, pages, and opens the day sheet', async () => {
    mount(<MonthScreen />);
    expect(await screen.findByRole('grid', { name: 'October 2026' })).toBeTruthy();
    // October 2026 starts on a Thursday and fits in five weeks.
    expect(screen.getAllByRole('gridcell')).toHaveLength(35);
    const today = await screen.findByRole('gridcell', { name: /October 30,/ });
    expect(today.className).toContain('is-today');
    fireEvent.click(today);
    const sheet = await screen.findByRole('dialog', { name: 'Friday, October 30' });
    expect(await within(sheet).findByText('Dinner with the Nguyens')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));

    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(await screen.findByRole('grid', { name: 'November 2026' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(await screen.findByRole('grid', { name: 'October 2026' })).toBeTruthy();
  });

  it('edits and deletes an event from the day sheet', async () => {
    mount(<MonthScreen />);
    fireEvent.click(await screen.findByRole('gridcell', { name: /October 30,/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Friday, October 30' });
    fireEvent.click(
      await within(sheet).findByRole('button', { name: 'Edit Dinner with the Nguyens' }),
    );
    const title = within(sheet).getByLabelText('Event title') as HTMLInputElement;
    expect(title.value).toBe('Dinner with the Nguyens');
    fireEvent.change(title, { target: { value: 'Dinner at the Nguyens' } });
    fireEvent.change(within(sheet).getByLabelText('Place'), { target: { value: 'Their place' } });
    await act(async () => {
      fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    });
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(decodeURIComponent(patch.url.pathname)).toMatch(/^\/api\/calendar\/events\/.+/);
    expect(patch.body).toMatchObject({ title: 'Dinner at the Nguyens', location: 'Their place' });

    fireEvent.click(await within(sheet).findByRole('button', { name: /^Edit Dinner/ }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete' }));
    const ask = await screen.findByRole('alertdialog');
    await act(async () => {
      fireEvent.click(within(ask).getByRole('button', { name: 'Delete' }));
    });
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
  });

  it('flips between Month and Week on the wall', async () => {
    mount(<MonthScreen />);
    expect(await screen.findByRole('grid', { name: 'October 2026' })).toBeTruthy();
    const views = screen.getByRole('group', { name: 'Calendar view' });
    fireEvent.click(within(views).getByRole('button', { name: 'Week' }));
    expect(await screen.findByRole('list', { name: /^Week of October 25/ })).toBeTruthy();
    expect(screen.queryByRole('grid')).toBeNull();
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Calendar view' })).getByRole('button', {
        name: 'Month',
      }),
    );
    expect(await screen.findByRole('grid', { name: 'October 2026' })).toBeTruthy();
  });
});
