import { DEFAULT_SCREENS, type Settings } from '../models.js';
import { people } from './people.js';

export function settings(): Settings {
  return {
    timezone: 'America/Los_Angeles',
    location: { name: 'Home', latitude: 37.7749, longitude: -122.4194, query: '' },
    units: 'imperial',
    theme: 'auto',
    schedule: {
      idleSeconds: 45,
      ambientFrom: '21:00',
      offFrom: '23:00',
      onAt: '06:00',
      brightness: [
        { at: '06:00', level: 60 },
        { at: '08:00', level: 100 },
        { at: '19:00', level: 70 },
        { at: '21:00', level: 35 },
      ],
      reloadAt: '04:00',
    },
    people: structuredClone(people),
    destinations: [
      {
        id: 'dest-school',
        name: 'Lincoln Elementary',
        address: '123 Lincoln Ave',
        personIds: ['sam', 'leo'],
        arriveBy: '07:55',
        days: [1, 2, 3, 4, 5],
      },
      {
        id: 'dest-office',
        name: 'Office',
        address: '500 Market St',
        personIds: ['jay'],
        arriveBy: '09:00',
        days: [1, 2, 3, 4],
      },
    ],
    flags: {
      commute: true,
      chores: true,
      meals: true,
      countdowns: true,
      media: true,
      doorbellPopover: true,
      alexaAnnouncements: false,
      remindersSync: false,
    },
    appearance: { skin: 'mantel', textSize: 'default', followSeason: false },
    layout: { todayPreset: 'agenda', monthPreset: 'grid', fit: 'fit', scale: 1 },
    screens: structuredClone(DEFAULT_SCREENS),
    defaultScreen: 'today',
    weather: { savedPlaces: [], personality: 'off' },
    integrations: { quips: { enabled: false } },
  };
}
