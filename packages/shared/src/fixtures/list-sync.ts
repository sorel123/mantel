/**
 * v4 L: the manifests of the three list-sharing plugins (Apple Reminders, Todoist, Home Assistant
 * to-do lists). The server's `plugins/<id>/manifest.ts` re-export these, so the copy Settings is
 * built against can't drift.
 */
import type { ListLink, ListSyncProviderInfo } from '../list-sync.js';
import type { PluginManifest } from '../plugins.js';
import { toLocalIso } from '../time.js';

export const remindersManifest: PluginManifest = {
  id: 'reminders',
  name: 'Apple Reminders',
  description:
    'Share a list with Apple Reminders, both ways, through a small helper on a Mac. Siri adds to Reminders, so "Hey Siri, add milk to Groceries" reaches the wall.',
  category: 'tasks',
  step: null,
  connect: 'none',
  optional: true,
  docs: 'list-sharing.md',
  directions: [
    'Download the Mantel Reminders helper for Mac from the [latest release](https://github.com/sorel123/mantel/releases/latest) (MantelReminders-mac.zip) and unzip it into Applications.',
    'The first time, right-click it and pick Open, then Open again: it is not notarised by Apple yet.',
    'Click the checklist icon in the menu bar, enter this server’s address and a pairing code from Settings › Displays, and allow access to Reminders.',
    'Then under Lists and chores, pick "Share this list with…" beside a list and choose a Reminders list. Shared family lists work too.',
    'It syncs while the Mac is awake. No Mac? See the Shortcuts recipe in the guide: one way, every hour or so.',
  ],
  fields: [],
  contributes: { events: ['list.changed'] },
};

export const todoistManifest: PluginManifest = {
  id: 'todoist',
  name: 'Todoist',
  description:
    'Share a list with a Todoist project, both ways. Ticks, adds and renames flow within a minute.',
  category: 'tasks',
  step: null,
  connect: 'fields',
  optional: true,
  docs: 'list-sharing.md',
  directions: [
    'Open [Todoist’s Integrations settings](https://app.todoist.com/app/settings/integrations/developer) and copy your API token from the Developer tab.',
    'Paste it below and press Test.',
    'Then under Lists and chores, pick "Share this list with…" beside a list and choose a Todoist project.',
  ],
  fields: [
    {
      key: 'token',
      label: 'API token',
      type: 'secret',
      required: true,
      help: 'Your personal token. It stays on this server, encrypted.',
      placeholder: '0123456789abcdef0123456789abcdef01234567',
      getItHere: {
        label: 'Todoist › Settings › Integrations › Developer',
        url: 'https://app.todoist.com/app/settings/integrations/developer',
      },
      advanced: false,
      readOnly: false,
      env: 'TODOIST_TOKEN',
    },
  ],
  contributes: { events: ['list.changed'] },
};

export const haTodoManifest: PluginManifest = {
  id: 'ha-todo',
  name: 'Home Assistant to-do lists',
  description:
    "Share a list with any Home Assistant to-do list: Google Tasks, Bring!, AnyList, Alexa's lists and more, both ways.",
  category: 'tasks',
  step: null,
  connect: 'none',
  optional: true,
  docs: 'list-sharing.md',
  directions: [
    'Connect Home Assistant under Home Assistant first; this uses the same connection.',
    'In Home Assistant, add the integration for the list you use (Local to-do, Shopping list, Google Tasks, AnyList, Bring!, Todoist or Alexa Devices). Each list becomes a to-do entity.',
    'Then under Lists and chores, pick "Share this list with…" beside a list and choose Home Assistant.',
  ],
  fields: [],
  contributes: { events: ['list.changed'] },
};

/** Sample answers for the list-sharing routes, as mock mode gives them. */
export function listSyncRouteFixtures(now = new Date()) {
  const at = toLocalIso(new Date(now.getTime() - 60_000));
  const links: ListLink[] = [
    {
      listId: 'list-grocery',
      provider: 'reminders',
      remoteListId: 'rem-groceries',
      remoteName: 'Groceries',
      state: 'ok',
      summary: 'Synced 1 minute ago',
      linkedAt: at,
      lastSyncAt: at,
      lastError: null,
    },
    {
      listId: 'list-todo',
      provider: 'todoist',
      remoteListId: 'td-home',
      remoteName: 'Home',
      state: 'ok',
      summary: 'Synced 1 minute ago',
      linkedAt: at,
      lastSyncAt: at,
      lastError: null,
    },
  ];
  const providers: ListSyncProviderInfo[] = [
    {
      id: 'reminders',
      name: 'Apple Reminders',
      ready: true,
      summary: "Jay's MacBook checked in just now",
      setup: '/settings#lists',
    },
    {
      id: 'todoist',
      name: 'Todoist',
      ready: true,
      summary: 'Connected to Todoist',
      setup: '/settings#integrations',
    },
    {
      id: 'ha-todo',
      name: 'Home Assistant',
      ready: true,
      summary: '3 to-do lists in Home Assistant',
      setup: '/settings#homeassistant',
    },
  ];
  return {
    listSync: { providers, links },
    listSyncRemote: {
      lists: [
        { id: 'rem-groceries', name: 'Groceries', detail: 'Shared with Sam and Ava' },
        { id: 'rem-family', name: 'Family' },
      ],
    },
    listLink: { link: links[0]! },
    listUnlink: { ok: true as const },
    listSyncNow: { link: links[0]! },
    remindersSync: { linked: ['rem-groceries'], ops: [], nextSeconds: 10 },
    remindersShortcut: { ok: true as const, listId: 'list-grocery', added: 2, ticked: 1 },
  };
}
