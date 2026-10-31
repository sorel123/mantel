/**
 * Weather and commute for the display (WS4). Mount these where the screens need them:
 * `WeatherCard` in Today's left column, `LeaveByChip` next to the event `matchLeaveBy` pairs
 * it with, `AmbientWeather` in Ambient mode. Demo: http://localhost:5173/src/features/weather/demo.html
 */
export { AmbientWeather } from './AmbientWeather';
export { formatHour, nextSun, outlook, worstPollen } from './format';
export { Icon, WeatherIcon, conditionIcon, type IconName } from './icons';
export { LeaveByChip, matchLeaveBy } from './LeaveByChip';
export {
  commuteResource,
  useCommute,
  useWeather,
  weatherResource,
  type LeaveBy,
  type Weather,
} from './store';
export { HourlyStrip, WeatherCard, WeatherExtras } from './WeatherCard';
