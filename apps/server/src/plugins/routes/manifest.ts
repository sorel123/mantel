import type { PluginManifest } from '@mantel/shared';

export const manifest: PluginManifest = {
  id: 'routes',
  name: 'Leave-by times',
  description:
    'Drive times to school and work. Free without a key; a Google key adds live traffic.',
  category: 'info',
  step: 'extras',
  connect: 'fields',
  optional: true,
  docs: 'weather-commute-photos.md',
  directions: [
    'Without a key, Mantel uses OpenStreetMap routing (OSRM) with no traffic.',
    'For live traffic, create a Google Maps Platform key with the Routes API enabled and paste it below.',
    'An OpenRouteService key (free) is a middle option: your own quota, still no traffic.',
  ],
  fields: [
    {
      key: 'googleKey',
      label: 'Google Maps Platform key',
      type: 'secret',
      required: false,
      advanced: false,
      readOnly: false,
      getItHere: {
        label: 'Google Cloud console, Credentials',
        url: 'https://console.cloud.google.com/apis/credentials',
      },
      help: 'Optional. Enables live traffic.',
      env: 'GOOGLE_ROUTES_API_KEY',
    },
    {
      key: 'openRouteServiceKey',
      label: 'OpenRouteService key',
      type: 'secret',
      required: false,
      advanced: true,
      readOnly: false,
      getItHere: {
        label: 'OpenRouteService dashboard',
        url: 'https://openrouteservice.org/dev/#/signup',
      },
      help: 'Optional. Free, no traffic.',
      env: 'OPENROUTESERVICE_API_KEY',
    },
    {
      key: 'osrmUrl',
      label: 'OSRM server',
      type: 'url',
      required: false,
      default: 'https://router.project-osrm.org',
      advanced: true,
      readOnly: false,
      env: 'OSRM_BASE_URL',
    },
  ],
  contributes: { todayCard: 'leave-by', events: ['commute.updated'] },
};
