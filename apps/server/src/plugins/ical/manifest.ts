import type { PluginManifest } from '@mantel/shared';

export const manifest: PluginManifest = {
  id: 'ical',
  name: 'Calendar link (iCal)',
  description:
    'The easy way: paste Google Calendar’s secret iCal address, or any .ics link. Read-only, no Cloud console.',
  category: 'calendar',
  step: 'calendars',
  connect: 'fields',
  optional: true,
  docs: 'calendars.md',
  directions: [
    'On a computer, open [Google Calendar settings](https://calendar.google.com/calendar/r/settings). Under Settings for my calendars, click the calendar to share.',
    'Scroll to Integrate calendar and copy Secret address in iCal format (it ends in basic.ics).',
    'Paste it below, one link per box, and press Test. Repeat for each family member’s calendar.',
    'Links are read-only: quick add writes to iCloud or a Google account connected with Google Calendar above. Any .ics link works too (Outlook, school, sports team).',
  ],
  fields: [
    {
      key: 'url1',
      label: 'Calendar link',
      type: 'secret',
      required: true,
      advanced: false,
      readOnly: false,
      placeholder: 'https://calendar.google.com/calendar/ical/…/private-…/basic.ics',
      help: 'Google: Settings → your calendar → Integrate calendar → Secret address in iCal format.',
      getItHere: {
        label: 'Google Calendar settings',
        url: 'https://calendar.google.com/calendar/r/settings',
      },
      env: 'ICAL_URLS',
    },
    {
      key: 'url2',
      label: 'Second calendar link',
      type: 'secret',
      required: false,
      advanced: false,
      readOnly: false,
      placeholder: 'Optional',
    },
    {
      key: 'url3',
      label: 'Third calendar link',
      type: 'secret',
      required: false,
      advanced: false,
      readOnly: false,
      placeholder: 'Optional',
    },
    {
      key: 'url4',
      label: 'More links',
      type: 'secret',
      required: false,
      advanced: true,
      readOnly: false,
      help: 'Several links separated by spaces or new lines.',
    },
  ],
  contributes: { events: ['calendar.changed'] },
};
