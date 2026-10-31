import { WeatherIcon } from './icons';
import { useWeather, type Weather } from './store';
import './weather.css';

/** The ambient screen's weather line: icon, temperature and summary, white on the photo. */
export function AmbientWeather({ weather }: { weather?: Weather }) {
  const live = useWeather();
  const w = weather ?? live.data;
  if (!w) return null;
  return (
    <div className="amb-weather">
      <WeatherIcon condition={w.current.condition} isDay={w.current.isDay} />
      <b className="tnum">{Math.round(w.current.temp)}°</b>
      <span>{w.current.summary}</span>
    </div>
  );
}
