import type { PluginManifest } from '@mantel/shared';

export const manifest: PluginManifest = {
  id: 'quips',
  name: 'Weather quips',
  description:
    'Lines of weather humour through the day. Built in; a Claude API key writes fresh ones and news jokes.',
  category: 'weather',
  step: 'extras',
  connect: 'fields',
  optional: true,
  docs: 'weather-commute-photos.md',
  directions: [
    'Quips work with no key, from a library of lines.',
    'For fresh lines through the day, create a key at the Claude console and paste it below.',
    'With a key, turn on Jokes about the news in Settings, Weather quips: the afternoon line riffs on a light story from the day’s headlines.',
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
      help: 'Optional. Three short requests a day, a fraction of a cent.',
      env: 'CLAUDE_API_KEY',
    },
    {
      key: 'newsFeed',
      label: 'News feed for news jokes',
      type: 'url',
      required: false,
      advanced: true,
      readOnly: false,
      placeholder: 'https://feeds.npr.org/1001/rss.xml',
      help: 'Any RSS or Atom feed. Only headlines are read, to inspire the joke; none are shown.',
    },
  ],
  contributes: { ambientSlot: 'quip', events: [] },
};
