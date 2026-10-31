import { isUrgentAlert } from '@mantel/shared';
import { WeatherIcon } from './icons';
import { useQuip, useWeather, type Weather } from './store';
import './weather.css';

/**
 * The ambient screen's weather line: icon, temperature and summary, white on the photo. Under
 * it, the day's quip when a personality is on, and the headline of any warning in force.
 */
export function AmbientWeather({ weather }: { weather?: Weather }) {
  const live = useWeather();
  const quip = useQuip().data;
  const w = weather ?? live.data;
  if (!w) return null;
  const warning = w.alerts.find(isUrgentAlert);
  return (
    <div className="amb-weather-block">
      <div className="amb-weather">
        <WeatherIcon condition={w.current.condition} isDay={w.current.isDay} />
        <b className="tnum">{Math.round(w.current.temp)}°</b>
        <span>{w.current.summary}</span>
      </div>
      {warning && <span className="amb-alert">{warning.event}</span>}
      {quip && <span className="amb-quip">{quip.text}</span>}
    </div>
  );
}
