/**
 * Today, through the layout presets: the slot grid from `app/layout` places the date, weather,
 * agenda, grocery, photo, people columns and the poster's bill as the chosen preset says. Every
 * preset shares the data hooks; `?today=<preset>` on the display's address pins one.
 */
import { addDays, cardZoom, startOfDay, type TodayCard } from '@mantel/shared';
import { Component, useState, type ReactNode } from 'react';
import { registerAmbientSlot } from '../../app/ambient';
import { useNow } from '../../app/Clock';
import { CardGrid, Slots, todayLayouts, todayWeekLayouts, useLayout } from '../../app/layout';
import { EmptyIcon, EmptyState } from '../../app/EmptyState';
import { useNav } from '../../app/nav';
import { PhotoSlideshow } from '../../features/photos';
import { WeatherCard, useWeather } from '../../features/weather';
import { useBootstrap } from '../../lib/bootstrap';
import { GroceryPeek } from '../lists/GroceryPeek';
import { useDaySheet } from '../month/DaySheet';
import { WeekStrip } from '../month/WeekStrip';
import '../month/month.css';
import { Agenda, Countdowns, TonightSlot } from './Agenda';
import { AmbientNextEvent } from './AmbientNext';
import { Bill } from './Bill';
import { eventsOn, useEvents } from './calendar';
import { DateBox, DateLine, Masthead } from './DateParts';
import { FamilyBoard } from './FamilyBoard';
import { Icon, Svg } from './parts';
import { PhotoPanel } from './PhotoPanel';
import { WeatherLine, WeekAhead } from './WeatherBits';
import './today.css';
import './presets.css';

// Ambient shows the next event under the weather line.
registerAmbientSlot({ id: 'next-event', Component: AmbientNextEvent, order: 1 });

type View = 'day' | 'week';
/** Day or Week, remembered while the display runs (leaving Today and coming back keeps it). */
let chosenView: View = 'day';

function ViewToggle({ value, onChange }: { value: View; onChange: (v: View) => void }) {
  return (
    <div className="seg view-toggle" role="group" aria-label="Today view">
      {(['day', 'week'] as const).map((v) => (
        <button
          key={v}
          type="button"
          className="btn"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
        >
          {v === 'day' ? 'Day' : 'Week'}
        </button>
      ))}
    </div>
  );
}

export function TodayScreen() {
  const now = useNow(30_000);
  const today = startOfDay(now);
  const { events } = useEvents(today, addDays(today, 4));
  const openDay = useDaySheet();
  const nav = useNav();
  const boot = useBootstrap();
  const layout = useLayout();
  const preset = layout.todayPreset;
  const [view, setViewState] = useState<View>(chosenView);
  const setView = (v: View) => {
    chosenView = v;
    setViewState(v);
  };
  const toggle = <ViewToggle value={view} onChange={setView} />;
  const weather = useWeather();
  const onAdd = () => openDay(today, { add: true });
  const onDay = (day: Date) => openDay(day);

  const render = (slot: string): ReactNode => {
    switch (slot) {
      case 'date':
        return <DateBox today={today} />;
      case 'date-line':
        return <DateLine today={today} />;
      case 'date-huge':
        return <Masthead today={today} count={eventsOn(events, today).length} />;
      case 'weather':
        return (
          <Guard name="weather">
            {weather.error && !weather.data ? (
              <div className="card weather">
                <EmptyState icon={EmptyIcon.weather} action="Set your location" section="home">
                  No weather yet. Tell Mantel where home is.
                </EmptyState>
              </div>
            ) : (
              <WeatherCard now={now} />
            )}
          </Guard>
        );
      case 'weather-line':
        return (
          <Guard name="weather" inline>
            <WeatherLine now={now} />
          </Guard>
        );
      case 'daily':
        return (
          <Guard name="daily">
            <WeekAhead />
          </Guard>
        );
      case 'week-strip':
        return (
          <div className="cal month today-week">
            <WeekStrip toggle={toggle} />
          </div>
        );
      case 'agenda':
        return (
          <Agenda
            now={now}
            events={events}
            onAdd={onAdd}
            onDay={onDay}
            onList={() => nav.go('lists')}
            rows={layout.todayRows}
            toggle={toggle}
          />
        );
      case 'agenda-short':
        return (
          <Agenda
            now={now}
            events={events}
            onAdd={onAdd}
            onDay={onDay}
            variant="short"
            toggle={toggle}
          />
        );
      case 'grocery':
        return (
          <Guard name="grocery">
            <GroceryPeek onOpen={() => nav.go('lists')} />
          </Guard>
        );
      case 'meals':
        return <TonightSlot today={today} />;
      case 'countdowns':
        return boot.flags.countdowns ? <Countdowns /> : null;
      case 'photo':
        return (
          <Guard name="photo">
            <PhotoPanel today={today} />
          </Guard>
        );
      case 'people':
        return <FamilyBoard now={now} events={events} onDay={onDay} />;
      case 'bill':
        return <Bill now={now} events={events} onAdd={onAdd} onDay={onDay} />;
      case 'add':
        return (
          <button className="add-round" aria-label="Add an event today" onClick={onAdd}>
            <Svg>{Icon.plus}</Svg>
          </button>
        );
      default:
        return null;
    }
  };

  if (preset === 'custom') {
    const cards = layout.todayCards;
    // The Day/Week switch rides on the agenda card unless the page already has a week card.
    const hasWeek = cards.some((c) => c.kind === 'week');
    const renderCard = (c: TodayCard): ReactNode => {
      switch (c.kind) {
        case 'date':
          return c.h >= 2 && c.w >= 3 ? render('date') : render('date-line');
        case 'weather':
          return bigWeather(c) ? (
            render('weather')
          ) : (
            <div className="card cc-line">{render('weather-line')}</div>
          );
        case 'forecast':
          return render('daily');
        case 'agenda':
          if (view === 'week' && !hasWeek) return render('week-strip');
          return (
            <Agenda
              now={now}
              events={events}
              onAdd={onAdd}
              onDay={onDay}
              onList={() => nav.go('lists')}
              rows={layout.todayRows.filter((r) => !cards.some((k) => k.kind === r))}
              variant={c.w >= 5 && c.h >= 6 ? 'full' : 'short'}
              toggle={hasWeek ? undefined : toggle}
            />
          );
        case 'week':
          return (
            <div className="cal month today-week">
              <WeekStrip />
            </div>
          );
        case 'photo':
          return (
            <Guard name="photo">
              <div className="card photo-panel" aria-label="Photos">
                <PhotoSlideshow intervalMs={20_000} />
              </div>
            </Guard>
          );
        case 'list':
          return render('grocery');
        case 'countdowns':
          return boot.flags.countdowns ? (
            <div className="card cc-pad">
              <Countdowns />
            </div>
          ) : null;
        case 'tonight':
          return (
            <div className="card cc-pad">
              <TonightSlot today={today} />
            </div>
          );
      }
    };
    return (
      <CardGrid
        className={`cal today${view === 'week' && !hasWeek ? ' week-view' : ''}`}
        cards={cards}
        render={renderCard}
        zoom={(c) => cardZoom(c, c.kind === 'weather' && !bigWeather(c) ? 'line' : undefined)}
      />
    );
  }

  // Week puts the seven-day strip where the agenda was, on layouts that have an agenda.
  const weekLayout = todayWeekLayouts[preset];
  const week = view === 'week' && weekLayout;
  const layoutNow = week ? weekLayout : todayLayouts[preset];
  return (
    <Slots className={`cal today${week ? ' week-view' : ''}`} layout={layoutNow} render={render} />
  );
}

/** A Custom weather card big enough for the full card; smaller ones are one line. */
const bigWeather = (c: TodayCard) => c.h >= 3.5 && c.w >= 3;

/**
 * Cards from other workstreams sit inside this, so one that throws leaves an empty slot
 * instead of taking the whole Today screen down.
 */
class Guard extends Component<
  { name: string; inline?: boolean; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(err: unknown) {
    console.warn(`Today: the ${this.props.name} card failed`, err);
  }
  override render() {
    if (!this.state.failed) return this.props.children;
    return this.props.inline ? (
      <span className="slot inline" data-slot={this.props.name} />
    ) : (
      <div className="card slot" data-slot={this.props.name} />
    );
  }
}
