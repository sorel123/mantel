import type { PluginManifest } from '@mantel/shared';

/** Directions for a household's own Google Cloud client. */
const OWN_CLIENT = [
  'Open the [Google Cloud console](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com), create a project and enable the Google Calendar API.',
  'In Google Auth Platform set the audience to External and press Publish app, or the sign-in expires after 7 days.',
  'Under Clients create a Web application client and add the redirect URI shown below.',
  'Paste the client ID and secret here (or drop the downloaded client JSON on the field), then press Connect.',
];

/**
 * The Google card. With Mantel's shared client (see shared-client.ts) it is Connect and sign
 * in; the client fields move under Advanced for anyone who wants their own Google Cloud app.
 */
export function googleManifest(shared: boolean): PluginManifest {
  if (!shared) return manifest;
  return {
    ...manifest,
    directions: [
      'Press Connect and sign in with the Google account that has the family calendars.',
      'Google may say it has not verified Mantel yet. Press Advanced, then Go to Mantel, then Continue.',
      'If the next page says it can’t be reached, copy its whole address from the browser bar and paste it in the box that appears here.',
      'Prefer your own Google Cloud app? Open Advanced and add its client ID and secret.',
    ],
    fields: manifest.fields.map((f) =>
      f.key === 'clientId' || f.key === 'clientSecret' || f.key === 'redirectUri'
        ? { ...f, required: false, advanced: true }
        : f,
    ),
  };
}

export const manifest: PluginManifest = {
  id: 'google',
  name: 'Google Calendar',
  description: 'Family calendars from Google, two-way, with quick add from the wall.',
  category: 'calendar',
  step: 'calendars',
  connect: 'oauth',
  optional: true,
  docs: 'calendars.md',
  directions: OWN_CLIENT,
  fields: [
    {
      key: 'clientId',
      label: 'Client ID',
      type: 'file-json',
      required: true,
      advanced: false,
      readOnly: false,
      placeholder: '1234567890-abc.apps.googleusercontent.com',
      help: 'From the OAuth client you created. Dropping the downloaded JSON fills both fields.',
      getItHere: {
        label: 'Google Cloud console, Clients',
        url: 'https://console.cloud.google.com/auth/clients',
      },
      env: 'GOOGLE_CLIENT_ID',
    },
    {
      key: 'clientSecret',
      label: 'Client secret',
      type: 'secret',
      required: true,
      advanced: false,
      readOnly: false,
      env: 'GOOGLE_CLIENT_SECRET',
    },
    {
      key: 'redirectUri',
      label: 'Authorised redirect URI',
      type: 'url',
      required: false,
      advanced: false,
      readOnly: true,
      help: 'Add this to the client in Google Cloud console.',
    },
    {
      key: 'pollSeconds',
      label: 'Sync every (seconds)',
      type: 'number',
      required: false,
      min: 30,
      default: 180,
      advanced: true,
      readOnly: false,
      env: 'CALENDAR_POLL_SECONDS',
    },
  ],
  contributes: { events: ['calendar.changed'] },
};
