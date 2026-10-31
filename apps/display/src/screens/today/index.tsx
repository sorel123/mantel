/**
 * Today, through the layout presets: the slot grid from `app/layout` places the date, weather,
 * agenda, grocery, photo, people columns and the poster's bill as the chosen preset says. Every
 * preset shares the data hooks; `?today=<preset>` on the display's address pins one.
 */
import { addDays, startOfDay } from '@mantel/shared';
import { Component, type ReactNode } from 'react';
import { registerAmbientSlot } from '../../app/ambient';
import { useNow } from '../../app/Clock';
import { Slots, todayLayouts, useLayout } from '../../app/layout';
import { EmptyIcon, EmptyState } from '../../app/EmptyState';
import { useNav } from '../../app/nav';
import { WeatherCard, useWeather } from '../../features/weather';
import { useBootstrap } from '../../lib/bootstrap';
import { GroceryPeek } from '../lists/GroceryPeek';
import { useDaySheet } from '../month/DaySheet';
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

export function TodayScreen() {
  const now = useNow(30_000);
  const today = startOfDay(now);
  const { events } = useEvents(today, addDays(today, 4));
  const openDay = useDaySheet();
  const nav = useNav();
  const boot = useBootstrap();
  const preset = useLayout().todayPreset;
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
      case 'agenda':
      case 'agenda-short':
        return (
          <Agenda
            now={now}
            events={events}
            onAdd={onAdd}
            onDay={onDay}
            variant={slot === 'agenda' ? 'full' : 'short'}
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

  return <Slots className="cal today" layout={todayLayouts[preset]} render={render} />;
}

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
