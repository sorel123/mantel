import type { PluginManifest } from '@mantel/shared';

export const manifest: PluginManifest = {
  id: 'pollen',
  name: 'Pollen',
  description:
    'Pollen levels on the weather card. Free in Europe; elsewhere a Google key is needed.',
  category: 'weather',
  step: 'extras',
  connect: 'fields',
  optional: true,
  docs: 'weather-commute-photos.md',
  directions: [
    'Create a Google Maps Platform key with the Pollen API enabled, or reuse the Leave-by key.',
  ],
  fields: [
    {
      key: 'googleKey',
      label: 'Google Pollen API key',
      type: 'secret',
      required: false,
      advanced: false,
      readOnly: false,
      getItHere: {
        label: 'Google Cloud console, Credentials',
        url: 'https://console.cloud.google.com/apis/credentials',
      },
      help: 'Leave empty to reuse the Leave-by key.',
      env: 'GOOGLE_POLLEN_API_KEY',
    },
  ],
  contributes: { events: [] },
};
