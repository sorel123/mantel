import type { WeatherCondition } from '@mantel/shared';

/** Line icons on a 24 px grid, drawn in the mockup's style (sun, partly, cloud, rain, moon) plus the rest of the set. */
const paths = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  partly:
    '<path d="M7 16a4 4 0 0 1 .7-7.9A5 5 0 0 1 17.3 10 3.5 3.5 0 0 1 17 17H7z"/><path d="M4.5 9.5 3.3 8.9M9 5.2 8.6 4M15 4.6l.6-1.2M20 8.8l1.2-.4"/>',
  partlyNight:
    '<path d="M7 18a4 4 0 0 1 .7-7.9A5 5 0 0 1 17.3 12 3.5 3.5 0 0 1 17 19H7z"/><path d="M14.5 3.2a4.6 4.6 0 0 0 6.3 5.4 4.6 4.6 0 0 1-3 3.2"/>',
  cloud: '<path d="M7 18a4.5 4.5 0 0 1 .6-9 6 6 0 0 1 11.6 1.7A3.7 3.7 0 0 1 18 18H7z"/>',
  fog: '<path d="M7 13a4.5 4.5 0 0 1 .6-9 6 6 0 0 1 11.6 1.7A3.7 3.7 0 0 1 18 13"/><path d="M4 16h16M6 19.5h12"/>',
  drizzle:
    '<path d="M7 15a4.5 4.5 0 0 1 .6-9 6 6 0 0 1 11.6 1.7A3.7 3.7 0 0 1 18 15H7z"/><path d="M8.5 18.5v.5M12.5 18.5v.5M16.5 18.5v.5M10.5 21v.5M14.5 21v.5"/>',
  rain: '<path d="M7 15a4.5 4.5 0 0 1 .6-9 6 6 0 0 1 11.6 1.7A3.7 3.7 0 0 1 18 15H7z"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/>',
  snow: '<path d="M7 15a4.5 4.5 0 0 1 .6-9 6 6 0 0 1 11.6 1.7A3.7 3.7 0 0 1 18 15H7z"/><path d="M8 18.5h.01M12 18.5h.01M16 18.5h.01M10 21.5h.01M14 21.5h.01" stroke-width="2.6"/>',
  sleet:
    '<path d="M7 15a4.5 4.5 0 0 1 .6-9 6 6 0 0 1 11.6 1.7A3.7 3.7 0 0 1 18 15H7z"/><path d="M8 18l-1 3M16 18l-1 3"/><path d="M12 19.5h.01" stroke-width="2.6"/>',
  storm:
    '<path d="M7 15a4.5 4.5 0 0 1 .6-9 6 6 0 0 1 11.6 1.7A3.7 3.7 0 0 1 18 15h-1"/><path d="M12.5 13 10 17.5h3.5L11 22"/>',
  wind: '<path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8"/>',
  car: '<path d="M5 16V11.5L7 6.5A2 2 0 0 1 8.9 5h6.2A2 2 0 0 1 17 6.5l2 5V16"/><path d="M3.5 16h17v2.5a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1V18h-9v.5a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1z"/><path d="M5 11.5h14M7.5 14h.01M16.5 14h.01"/>',
  alert: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17h.01"/>',
} as const;

export type IconName = keyof typeof paths;

/** The icon for a condition; clear and partly skies switch to the moon at night. */
export function conditionIcon(condition: WeatherCondition, isDay = true): IconName {
  switch (condition) {
    case 'clear':
      return isDay ? 'sun' : 'moon';
    case 'partly':
      return isDay ? 'partly' : 'partlyNight';
    case 'cloudy':
      return 'cloud';
    default:
      return condition;
  }
}

export function Icon({ name, className = 'wico' }: { name: IconName; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: paths[name] }}
    />
  );
}

export function WeatherIcon({
  condition,
  isDay,
  className,
}: {
  condition: WeatherCondition;
  isDay?: boolean;
  className?: string;
}) {
  return <Icon name={conditionIcon(condition, isDay)} className={className} />;
}
