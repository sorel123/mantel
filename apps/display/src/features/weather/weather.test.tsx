import {
  commute,
  eventsInRange,
  weatherQuip,
  weather as weatherFixture,
} from '@mantel/shared/fixtures';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { OverlayProvider } from '../../app/overlay';
import { WeatherAlertLayer } from './AlertLayer';
import { AmbientWeather } from './AmbientWeather';
import {
  compass,
  dayLabel,
  formatAmount,
  formatHour,
  hourDayLabel,
  outlook,
  worstPollen,
} from './format';
import { LeaveByChip, matchLeaveBy } from './LeaveByChip';
import { dismissAlert, quipResource, showAlert, type Weather } from './store';
import { HourlyStrip, WeatherCard } from './WeatherCard';
import { AlertsTab, DailyTab, DetailsTab, TempChart, WeatherSheet } from './WeatherSheet';

// 7:20 am local, so the fixture's hours start at 8 am.
const NOW = new Date(2026, 9, 30, 7, 20);
const fixture = () => weatherFixture(NOW);

describe('weather formatting', () => {
  it('formats hours like the mockup', () => {
    expect(formatHour(new Date(2026, 0, 1, 0))).toBe('12 am');
    expect(formatHour(new Date(2026, 0, 1, 18, 30))).toBe('6:30 pm');
  });

  it('writes the outlook line from the rest of today', () => {
    const w = fixture();
    // The fixture's hourly series turns to rain at its sixth hour: 1 pm.
    expect(outlook(w, NOW)).toBe('Rain after 1 pm');
    const raining: Weather = {
      ...w,
      current: { ...w.current, condition: 'rain', precipChance: 90 },
    };
    expect(outlook(raining, NOW)).toBe('Rain until 8 am');
    const dry: Weather = {
      ...w,
      hourly: w.hourly.map((h) => ({ ...h, condition: 'clear', precipChance: 0 })),
    };
    expect(outlook(dry, NOW)).toBe('Wind 7 mph');
    expect(outlook({ ...dry, current: { ...dry.current, feelsLike: 48 } }, NOW)).toBe(
      'Feels like 48°',
    );
  });

  it('picks the worst pollen group', () => {
    expect(worstPollen({ tree: 'low', grass: 'high', weed: 'moderate' })).toMatchObject({
      label: 'Grass',
      level: 'High',
    });
    expect(worstPollen(null)).toBeNull();
  });

  it('labels days and hours relative to now', () => {
    expect(dayLabel('2026-10-30', NOW)).toBe('Today');
    expect(dayLabel('2026-10-31', NOW)).toBe('Tomorrow');
    expect(dayLabel('2026-11-02', NOW)).toBe('Mon');
    expect(dayLabel('2026-11-02', NOW, true)).toBe('Monday');
    expect(hourDayLabel(new Date(2026, 9, 30, 23).toISOString(), NOW)).toBe('Today');
    expect(hourDayLabel(new Date(2026, 9, 31, 1).toISOString(), NOW)).toBe('Sat');
    expect(hourDayLabel(new Date(2026, 10, 1, 1).toISOString(), NOW)).toBe('Sun');
  });

  it('formats wind direction and rain amounts', () => {
    expect(compass(0)).toBe('N');
    expect(compass(225)).toBe('SW');
    expect(formatAmount(0.35, 'imperial')).toBe('0.35 in');
    expect(formatAmount(4, 'metric')).toBe('4 mm');
    expect(formatAmount(0, 'metric')).toBeNull();
    expect(formatAmount(undefined, 'metric')).toBeNull();
  });
});

describe('WeatherCard', () => {
  afterEach(() => {
    quipResource.set(null);
  });

  it('renders now, the next 48 hours and the extras', () => {
    const { container } = render(<WeatherCard weather={fixture()} now={NOW} interactive={false} />);
    expect(container.querySelector('.temp')!.textContent).toBe('54°');
    expect(screen.getByText('Partly cloudy')).toBeTruthy();
    expect(screen.getByText('H 61° · L 44°')).toBeTruthy();
    expect(screen.getByText('Next')).toBeTruthy();
    // Two afternoons in 48 hours.
    expect(screen.getAllByText('1 pm')).toHaveLength(2);
    expect(screen.getByText('Sunrise')).toBeTruthy();
    expect(screen.getByText('Good')).toBeTruthy();
    expect(screen.getByText('grass')).toBeTruthy();
    const strip = screen.getByRole('list', { name: 'Hourly forecast' });
    expect(within(strip).getAllByRole('listitem')).toHaveLength(48);
    // Where a new day starts the column names the day instead of the hour.
    expect(within(strip).getByText('Sat')).toBeTruthy();
    expect(within(strip).getByText('Sun')).toBeTruthy();
    expect(strip.querySelectorAll('.new-day')).toHaveLength(2);
    // Wet hours get a rain bar sized by their chance.
    const wet = strip.querySelector('.rain[style*="--p: 0.7"]');
    expect(wet).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open the forecast' })).toBeNull();
  });

  it("shows the quip in the outlook line's place when a personality is on", () => {
    const w = fixture();
    const { rerender } = render(<WeatherCard weather={w} now={NOW} interactive={false} />);
    expect(screen.getByText('Rain after 1 pm')).toBeTruthy();
    act(() => quipResource.set(weatherQuip(NOW)));
    rerender(<WeatherCard weather={w} now={NOW} interactive={false} />);
    expect(screen.queryByText('Rain after 1 pm')).toBeNull();
    expect(screen.getByText(/Bring the good umbrella/)).toBeTruthy();
  });

  it('opens the weather sheet from the card and switches its tabs', async () => {
    render(
      <OverlayProvider>
        <WeatherCard weather={fixture()} now={NOW} />
      </OverlayProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open the forecast' }));
    const sheet = await screen.findByRole('dialog', { name: 'Weather, Home' });
    expect(within(sheet).getByRole('heading', { name: 'Home' })).toBeTruthy();
    expect(within(sheet).getByRole('tab', { name: 'Hourly' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(within(sheet).getByRole('img', { name: /Temperature and rain/ })).toBeTruthy();

    fireEvent.click(within(sheet).getByRole('tab', { name: '10-day' }));
    const days = within(sheet).getByRole('list', { name: 'Ten-day forecast' });
    expect(within(days).getAllByRole('listitem')).toHaveLength(10);
    expect(within(days).getByText('Today')).toBeTruthy();
    expect(within(days).getByText('Tomorrow')).toBeTruthy();

    fireEvent.click(within(sheet).getByRole('tab', { name: 'Details' }));
    expect(within(sheet).getByText('Dew point')).toBeTruthy();
    expect(within(sheet).getByText('Moon')).toBeTruthy();

    fireEvent.click(within(sheet).getByRole('tab', { name: 'Alerts' }));
    expect(within(sheet).getByText(/No alerts for Home/)).toBeTruthy();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 3000 });
  });

  it('shows alerts and opens their details on tap', () => {
    const w = fixture();
    const alert = {
      id: 'a1',
      event: 'Wind Advisory',
      severity: 'moderate' as const,
      headline: 'Wind Advisory until 6 PM',
      description: 'Gusts to 45 mph.',
      starts: w.updatedAt,
      ends: null,
    };
    render(
      <WeatherCard
        weather={{ ...w, alerts: [alert, { ...alert, id: 'a2' }] }}
        now={NOW}
        interactive={false}
      />,
    );
    const button = screen.getByRole('button', { name: /Wind Advisory/ });
    expect(screen.getByText('and 1 more')).toBeTruthy();
    expect(screen.queryByText('Gusts to 45 mph.')).toBeNull();
    fireEvent.click(button);
    expect(screen.getByText('Gusts to 45 mph.')).toBeTruthy();
  });

  it('hides air quality and pollen when the server has none', () => {
    render(
      <WeatherCard
        weather={{ ...fixture(), airQuality: null, pollen: null }}
        now={NOW}
        interactive={false}
      />,
    );
    expect(screen.queryByText('Air')).toBeNull();
    expect(screen.queryByText('Pollen')).toBeNull();
  });
});

describe('WeatherSheet pieces', () => {
  const alert = (w: Weather) => ({
    id: 'a1',
    event: 'High Wind Warning',
    severity: 'severe' as const,
    headline: 'High Wind Warning until 6 PM',
    description: 'Gusts to 60 mph.',
    starts: w.updatedAt,
    ends: null,
  });

  it('draws the temperature chart with rain bars and the high and low', () => {
    const { container } = render(<TempChart weather={fixture()} now={NOW} />);
    const svg = container.querySelector('svg.wx-chart')!;
    expect(svg.querySelectorAll('.bar').length).toBeGreaterThan(10);
    expect(svg.querySelector('.line')!.getAttribute('d')).toMatch(/^M/);
    const marks = Array.from(svg.querySelectorAll('.mark text')).map((t) => t.textContent);
    expect(marks).toContain('59°');
    expect(marks).toContain('43°');
    expect(svg.querySelector('.day text')!.textContent).toBe('Sat');
  });

  it('shows ten days with their range bars', () => {
    const { container } = render(<DailyTab weather={fixture()} now={NOW} />);
    const rows = container.querySelectorAll('.wx-days li');
    expect(rows).toHaveLength(10);
    expect(rows[0]!.textContent).toContain('Today');
    expect(rows[0]!.textContent).toContain('61°');
    expect(container.querySelectorAll('.range i')).toHaveLength(10);
  });

  it('lists every measurement in details', () => {
    render(<DetailsTab weather={fixture()} now={NOW} />);
    for (const label of ['Humidity', 'Wind', 'Pressure', 'Visibility', 'Sunrise', 'Pollen']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText(/mph/)).toBeTruthy();
    expect(screen.getByText(/hPa/)).toBeTruthy();
  });

  it('counts alerts on the tab and lists them', () => {
    const w = fixture();
    const withAlert = { ...w, alerts: [alert(w)] };
    render(<AlertsTab weather={withAlert} now={NOW} />);
    expect(screen.getByText('High Wind Warning')).toBeTruthy();
    expect(screen.getByText('Gusts to 60 mph.')).toBeTruthy();
    expect(screen.getByText(/Severe/)).toBeTruthy();
  });

  it('shows the alert count on the sheet tab and keeps the home place first', () => {
    const w = fixture();
    render(<WeatherSheet home={{ ...w, alerts: [alert(w)] }} now={NOW} onClose={() => {}} />);
    expect(screen.getByRole('tab', { name: /Alerts\s*1/ })).toBeTruthy();
    const places = screen.getByRole('group', { name: 'Places' });
    expect(within(places).getByRole('button', { name: 'Home' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('searchbox', { name: 'Search for a place' })).toBeTruthy();
  });

  it("keeps the strip's listitems to the hours asked for", () => {
    render(<HourlyStrip weather={fixture()} hours={12} now={NOW} size="sheet" />);
    expect(screen.getAllByRole('listitem')).toHaveLength(12);
  });
});

describe('weather alerts', () => {
  afterEach(() => {
    dismissAlert();
    quipResource.set(null);
  });

  it('shows the banner for a pushed warning until dismissed', async () => {
    const w = fixture();
    render(<WeatherAlertLayer />);
    expect(screen.queryByRole('alert')).toBeNull();
    act(() =>
      showAlert({
        locationName: 'San Francisco',
        alert: {
          id: 'w1',
          event: 'Tornado Warning',
          severity: 'extreme',
          headline: 'Tornado Warning',
          description: 'Take shelter now.',
          starts: w.updatedAt,
          ends: null,
        },
      }),
    );
    const banner = screen.getByRole('alert');
    expect(within(banner).getByText('Tornado Warning')).toBeTruthy();
    expect(within(banner).getByText('Take shelter now.')).toBeTruthy();
    fireEvent.click(within(banner).getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull(), { timeout: 3000 });
  });

  it('puts the warning and the quip under the ambient weather line', () => {
    const w = fixture();
    const warning = {
      id: 'w2',
      event: 'Winter Storm Warning',
      severity: 'severe' as const,
      headline: '',
      description: '',
      starts: w.updatedAt,
      ends: null,
    };
    act(() => quipResource.set(weatherQuip(NOW)));
    const { container } = render(<AmbientWeather weather={{ ...w, alerts: [warning] }} />);
    expect(container.querySelector('.amb-alert')!.textContent).toBe('Winter Storm Warning');
    expect(container.querySelector('.amb-quip')!.textContent).toMatch(/umbrella/);
  });
});

describe('leave-by', () => {
  const trips = commute(NOW, { force: true }).leaveBy;

  it('pairs trips with their events', () => {
    const day = new Date(NOW);
    day.setHours(0, 0, 0, 0);
    const events = eventsInRange(NOW, day, new Date(day.getTime() + 864e5));
    const paired = matchLeaveBy(events, trips);
    // School has a server match; the office trip finds Jay's 9 am standup by time and person.
    expect(paired.get('evt-fixed-0')?.destinationId).toBe('dest-school');
    const standup = events.find((e) => e.title === 'Team standup')!;
    expect(paired.get(standup.id)?.destinationId).toBe('dest-office');
    expect(paired.size).toBe(2);
  });

  it('lets a trip for an event address claim its event before a destination does', () => {
    const event = {
      id: 'dentist',
      calendarId: 'c',
      title: 'Dentist',
      start: new Date(2026, 10, 2, 8, 0).toISOString(),
      end: new Date(2026, 10, 2, 9, 0).toISOString(),
      allDay: false,
      personIds: ['jay'],
      color: '#000',
      countdown: false,
    };
    const at = (h: number, m: number) => new Date(2026, 10, 2, h, m).toISOString();
    const office = {
      destinationId: 'dest-office',
      name: 'Office',
      leaveBy: at(7, 30),
      arriveBy: at(8, 0),
      durationMinutes: 30,
      delayMinutes: 0,
      personIds: ['jay'],
    };
    const dentist = { ...office, destinationId: 'event:x', name: 'Dentist', eventId: 'dentist' };
    expect(matchLeaveBy([event], [office, dentist]).get('dentist')?.name).toBe('Dentist');
  });

  it('counts down to leaving and then says leave now', () => {
    const trip = trips[0]!;
    const leave = new Date(trip.leaveBy).getTime();
    const { rerender, container } = render(
      <LeaveByChip trip={trip} now={new Date(leave - 3600e3)} />,
    );
    expect(screen.getByText('Leave by 7:38')).toBeTruthy();
    expect(screen.getByText(/\+3 traffic/)).toBeTruthy();
    expect(container.firstElementChild!.getAttribute('data-state')).toBeNull();
    rerender(<LeaveByChip trip={trip} now={new Date(leave - 5 * 60e3)} />);
    expect(container.firstElementChild!.getAttribute('data-state')).toBe('soon');
    rerender(<LeaveByChip trip={trip} now={new Date(leave + 60e3)} />);
    expect(screen.getByText('Leave now')).toBeTruthy();
    expect(container.firstElementChild!.getAttribute('data-state')).toBe('late');
  });
});
