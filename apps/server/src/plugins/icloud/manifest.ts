import type { PluginManifest } from '@mantel/shared';

export const manifest: PluginManifest = {
  id: 'icloud',
  name: 'iCloud Calendar',
  description: 'Calendars from an Apple ID over CalDAV.',
  category: 'calendar',
  step: 'calendars',
  connect: 'fields',
  optional: true,
  docs: 'calendars.md',
  directions: [
    'Sign in at [appleid.apple.com](https://appleid.apple.com/account/manage) and open Sign-In and Security, App-Specific Passwords.',
    'Generate a password named Mantel and paste it below with the Apple ID email.',
    'Press Test; Mantel lists the calendars it can see.',
  ],
  fields: [
    {
      key: 'username',
      label: 'Apple ID email',
      type: 'text',
      required: true,
      advanced: false,
      readOnly: false,
      placeholder: 'you@icloud.com',
      env: 'ICLOUD_USERNAME',
    },
    {
      key: 'appPassword',
      label: 'App-specific password',
      type: 'secret',
      required: true,
      advanced: false,
      readOnly: false,
      placeholder: 'abcd-efgh-ijkl-mnop',
      getItHere: {
        label: 'Apple ID, app-specific passwords',
        url: 'https://appleid.apple.com/account/manage',
      },
      env: 'ICLOUD_APP_PASSWORD',
    },
    {
      key: 'caldavUrl',
      label: 'CalDAV server',
      type: 'url',
      required: false,
      default: 'https://caldav.icloud.com/',
      advanced: true,
      readOnly: false,
      env: 'ICLOUD_CALDAV_URL',
    },
  ],
  contributes: { events: ['calendar.changed'] },
};
