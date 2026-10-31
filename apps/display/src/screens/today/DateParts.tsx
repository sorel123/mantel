/** The date in three sizes: the Agenda preset's big block, one line, and the Poster masthead. */
import { dayNames, monthNames } from './calendar';

export function DateBox({ today }: { today: Date }) {
  return (
    <div className="datebox">
      <div className="wd">{dayNames[today.getDay()]}</div>
      <div className="big">
        <span className="dn tnum">{today.getDate()}</span>
        <span className="mo">{monthNames[today.getMonth()]}</span>
      </div>
    </div>
  );
}

export function DateLine({ today }: { today: Date }) {
  return (
    <div className="dateline">
      <span className="wd">{dayNames[today.getDay()]}</span>
      <b>
        {monthNames[today.getMonth()]} <span className="tnum">{today.getDate()}</span>
      </b>
    </div>
  );
}

export function Masthead({ today, count }: { today: Date; count: number }) {
  return (
    <header className="masthead" aria-label="Today">
      <div className="ml">
        <span className="eyebrow">{dayNames[today.getDay()]}</span>
        <b className="dn tnum">{today.getDate()}</b>
      </div>
      <div className="mr">
        <span className="mo">{monthNames[today.getMonth()]}</span>
        <span className="yr tnum">{today.getFullYear()}</span>
        <span className="cnt">
          {count === 0 ? 'Nothing on the bill' : `${count} ${count === 1 ? 'event' : 'events'}`}
        </span>
      </div>
    </header>
  );
}
