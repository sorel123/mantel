/**
 * Weather and commute for the display (workstream D, formerly WS4). `WeatherCard` sits in
 * Today's left column and opens `WeatherSheet` through the shell's overlay; `LeaveByChip` goes
 * next to the event `matchLeaveBy` pairs it with; `AmbientWeather` is registered as an Ambient
 * slot by the shell; `WeatherAlertLayer` is mounted by the shell's feature layers (any export
 * ending in `Layer`). Demo: http://localhost:5173/src/features/weather/demo.html
 */
export { WeatherAlertLayer } from './AlertLayer';
export { AmbientWeather } from './AmbientWeather';
export {
  compass,
  dayLabel,
  formatAmount,
  formatHour,
  formatWhen,
  hourDayLabel,
  nextSun,
  outlook,
  worstPollen,
} from './format';
export { Icon, WeatherIcon, conditionIcon, type IconName } from './icons';
export { LeaveByChip, matchLeaveBy } from './LeaveByChip';
export {
  commuteResource,
  dismissAlert,
  fetchPlace,
  quipResource,
  searchPlaces,
  showAlert,
  useActiveAlert,
  useCommute,
  useQuip,
  useWeather,
  useWeatherPrefs,
  weatherPrefsResource,
  weatherResource,
  type LeaveBy,
  type Quip,
  type Weather,
} from './store';
export { HourlyStrip, STRIP_SNAP_BACK_MS, WeatherCard, WeatherExtras } from './WeatherCard';
export {
  AlertsTab,
  DailyTab,
  DetailsTab,
  HourlyTab,
  TempChart,
  WeatherSheet,
} from './WeatherSheet';
