import { PhotoSlideshow } from '../../features/photos';
import { dayNames, monthNames } from './calendar';

/** The Photo preset's left panel: the album as a card, the date in its corner. */
export function PhotoPanel({ today }: { today: Date }) {
  return (
    <div className="card photo-panel" aria-label="Photos">
      <PhotoSlideshow intervalMs={20_000} />
      <div className="veil" aria-hidden="true" />
      <div className="pdate">
        <span className="wd">{dayNames[today.getDay()]}</span>
        <b className="tnum">{today.getDate()}</b>
        <span className="mo">{monthNames[today.getMonth()]}</span>
      </div>
    </div>
  );
}
