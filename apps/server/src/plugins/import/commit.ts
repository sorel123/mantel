/**
 * Write the candidates the person kept, through the same providers the wall's own quick add and
 * lists use. Each piece that fails is reported in a sentence; the rest still goes in.
 */
import type { CalendarEvent, ImportCommitRequest, ImportEvent } from '@mantel/shared';
import { ImportCommitRequest as CommitSchema } from '@mantel/shared';
import type { z } from 'zod';
import type { Providers } from '../../providers/types.js';
import { isoInZone } from '../../providers/real/weather-time.js';
import { shiftDate, wallIso } from './zone.js';

type Commit = z.output<typeof CommitSchema>;

const why = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Start and end of an imported event in the household's zone. */
export function eventTimes(e: ImportEvent, timeZone: string) {
  if (e.allDay) {
    const last = e.endDate && e.endDate >= e.date ? e.endDate : e.date;
    return {
      start: wallIso(e.date, '00:00', timeZone),
      end: wallIso(shiftDate(last, 1), '00:00', timeZone),
      allDay: true,
    };
  }
  const start = wallIso(e.date, e.start ?? '09:00', timeZone);
  // No end, or one before the start: an hour long.
  const end =
    e.end && e.end > (e.start ?? '00:00')
      ? wallIso(e.date, e.end, timeZone)
      : isoInZone(new Date(Date.parse(start) + 3_600_000), timeZone);
  return { start, end, allDay: false };
}

const SLOT_WORD = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', other: 'Meal' };

export async function commitImport(
  req: Commit | ImportCommitRequest,
  providers: Pick<Providers, 'calendar' | 'lists'>,
  timeZone: string,
) {
  const body = CommitSchema.parse(req);
  const problems: string[] = [];
  const events: CalendarEvent[] = [];

  for (const e of body.events) {
    try {
      const { event } = await providers.calendar.quickAdd({
        title: e.title,
        ...eventTimes(e, timeZone),
        ...(e.personIds.length ? { personIds: e.personIds } : {}),
        ...(body.calendarId ? { calendarId: body.calendarId } : {}),
      });
      let saved = event;
      if (e.location) {
        try {
          saved = (await providers.calendar.updateEvent(event.id, { location: e.location })).event;
        } catch {
          problems.push(`${e.title} was added without its place (${e.location}).`);
        }
      }
      events.push(saved);
    } catch (err) {
      problems.push(`Could not add ${e.title}: ${why(err)}`);
    }
  }

  let items = 0;
  if (body.items.length) {
    let lists = (await providers.lists.lists()).lists;
    for (const i of body.items) {
      try {
        let list =
          lists.find((l) => l.id === i.listId) ??
          lists.find((l) => l.name.toLowerCase() === i.listName.toLowerCase());
        if (!list) {
          list = (await providers.lists.createList({ name: i.listName })).list;
          lists = [...lists, list];
        }
        await providers.lists.addItem(list.id, { text: i.text });
        items++;
      } catch (err) {
        problems.push(`Could not add ${i.text}: ${why(err)}`);
      }
    }
  }

  // Meals go on the Meals calendar as all-day "Dinner: Tacos" events, which the wall already
  // reads as the meal plan. The meal planner (workstream M) can take these over later.
  let meals = 0;
  if (body.meals.length) {
    const cals = await providers.calendar.calendars().catch(() => []);
    const mealsCal = cals.find((c) => c.isMeals && !c.readOnly && c.source !== 'ical');
    if (!mealsCal) {
      problems.push(
        `${body.meals.length} meal${body.meals.length === 1 ? '' : 's'} not added: connect a Meals calendar that Mantel can write to, in Settings › Calendars.`,
      );
    } else {
      for (const m of body.meals) {
        try {
          await providers.calendar.quickAdd({
            title: `${SLOT_WORD[m.slot]}: ${m.title}`,
            start: wallIso(m.date, '00:00', timeZone),
            end: wallIso(shiftDate(m.date, 1), '00:00', timeZone),
            allDay: true,
            calendarId: mealsCal.id,
          });
          meals++;
        } catch (err) {
          problems.push(`Could not add ${m.title}: ${why(err)}`);
        }
      }
    }
  }

  return { events, items, meals, problems };
}
