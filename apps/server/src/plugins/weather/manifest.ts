import type { PluginManifest } from '@mantel/shared';

export const manifest: PluginManifest = {
  id: 'weather',
  name: 'Weather',
  description:
    'Forecast, air quality and alerts from Open-Meteo and the National Weather Service. No key needed.',
  category: 'weather',
  step: 'home',
  connect: 'fields',
  optional: false,
  docs: 'weather-commute-photos.md',
  directions: [],
  fields: [
    {
      key: 'nwsContact',
      label: 'Contact for weather.gov',
      type: 'text',
      required: false,
      advanced: true,
      readOnly: false,
      placeholder: 'you@example.com',
      help: 'The US weather service asks who is calling. Any email or website.',
      env: 'NWS_CONTACT',
    },
  ],
  contributes: {
    todayCard: 'weather',
    ambientSlot: 'weather',
    events: ['weather.updated', 'weather.alert'],
  },
};
