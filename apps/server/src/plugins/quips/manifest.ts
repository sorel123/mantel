import type { PluginManifest } from '@mantel/shared';

export const manifest: PluginManifest = {
  id: 'quips',
  name: 'Weather quips',
  description: 'A line of weather humour each day. Built in; a Claude API key writes fresh ones.',
  category: 'weather',
  step: 'extras',
  connect: 'fields',
  optional: true,
  docs: 'weather-commute-photos.md',
  directions: [
    'Quips work with no key, from a library of lines.',
    'For a new line each morning, create a key at the Claude console and paste it below.',
  ],
  fields: [
    {
      key: 'claudeApiKey',
      label: 'Claude API key',
      type: 'secret',
      required: false,
      advanced: false,
      readOnly: false,
      getItHere: {
        label: 'Claude console, API keys',
        url: 'https://platform.claude.com/settings/keys',
      },
      help: 'Optional. One short request a day.',
      env: 'CLAUDE_API_KEY',
    },
  ],
  contributes: { ambientSlot: 'quip', events: [] },
};
