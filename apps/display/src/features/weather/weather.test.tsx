import { commute, eventsInRange, weather as weatherFixture } from '@mantel/shared/fixtures';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { formatHour, outlook, worstPollen } from './format';
import { LeaveByChip, matchLeaveBy } from './LeaveByChip';
import type { Weather } from './store';
import { WeatherCard } from './WeatherCard';

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
});

describe('WeatherCard', () => {
  it('renders now, the next six hours and the extras', () => {
    const { container } = render(<WeatherCard weather={fixture()} now={NOW} />);
    expect(container.querySelector('.temp')!.textContent).toBe('54°');
    expect(screen.getByText('Partly cloudy')).toBeTruthy();
    expect(screen.getByText('H 61° · L 44°')).toBeTruthy();
    expect(screen.getByText('Next')).toBeTruthy();
    expect(screen.getByText('1 pm')).toBeTruthy();
    expect(screen.getByText('Sunrise')).toBeTruthy();
    expect(screen.getByText('Good')).toBeTruthy();
    expect(screen.getByText('grass')).toBeTruthy();
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
    render(<WeatherCard weather={{ ...w, alerts: [alert, { ...alert, id: 'a2' }] }} now={NOW} />);
    const button = screen.getByRole('button', { name: /Wind Advisory/ });
    expect(screen.getByText('and 1 more')).toBeTruthy();
    expect(screen.queryByText('Gusts to 45 mph.')).toBeNull();
    fireEvent.click(button);
    expect(screen.getByText('Gusts to 45 mph.')).toBeTruthy();
  });

  it('hides air quality and pollen when the server has none', () => {
    render(<WeatherCard weather={{ ...fixture(), airQuality: null, pollen: null }} now={NOW} />);
    expect(screen.queryByText('Air')).toBeNull();
    expect(screen.queryByText('Pollen')).toBeNull();
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
