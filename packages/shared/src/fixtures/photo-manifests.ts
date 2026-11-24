/**
 * v4 S: the photo source manifests. The server's plugins re-export these, so the copy the
 * display renders in mock mode can never drift from the real one.
 */
import type { PluginManifest } from '../plugins.js';

export const immichManifest: PluginManifest = {
  id: 'immich',
  name: 'Immich',
  description:
    'Your self-hosted Immich library: favourites, chosen albums or everything, plus its "On this day" memories.',
  category: 'photos',
  step: 'extras',
  connect: 'fields',
  optional: true,
  docs: 'weather-commute-photos.md',
  directions: [
    'Open Immich in a browser, click your avatar, then Account Settings, then API Keys, then New API Key.',
    'Name it Mantel. Give it album.read, asset.read, asset.view and memory.read (or All), then copy the key.',
    'Paste Immich’s address and the key below and press Test. Use the address Mantel’s server can reach, such as http://192.168.1.20:2283.',
    'Choose what to show. Favourites is a good start: heart a photo in Immich and it joins the wall within the hour.',
  ],
  fields: [
    {
      key: 'url',
      label: 'Immich address',
      type: 'url',
      required: true,
      advanced: false,
      readOnly: false,
      placeholder: 'http://192.168.1.20:2283',
      help: 'The same address you open Immich at.',
      env: 'IMMICH_URL',
    },
    {
      key: 'apiKey',
      label: 'API key',
      type: 'secret',
      required: true,
      advanced: false,
      readOnly: false,
      getItHere: {
        label: 'Immich, Account Settings, API Keys',
        url: 'https://immich.app/docs/features/command-line-interface#obtain-the-api-key',
      },
      env: 'IMMICH_API_KEY',
    },
    {
      key: 'mode',
      label: 'Show',
      type: 'select',
      required: false,
      advanced: false,
      readOnly: false,
      default: 'favorites',
      options: [
        { value: 'favorites', label: 'Favourites' },
        { value: 'albums', label: 'Chosen albums' },
        { value: 'all', label: 'Everything (newest first)' },
      ],
    },
    {
      key: 'albums',
      label: 'Albums',
      type: 'text',
      required: false,
      advanced: false,
      readOnly: false,
      placeholder: 'Family, Summer 2025',
      help: 'Album names, separated by commas. Test lists the albums Immich has.',
      dependsOn: { key: 'mode', equals: 'albums' },
    },
    {
      key: 'memories',
      label: 'Add Immich’s “On this day” memories',
      type: 'toggle',
      required: false,
      advanced: false,
      readOnly: false,
      default: true,
      help: 'Photos from this date in past years, from the whole library.',
    },
    {
      key: 'limit',
      label: 'Most photos to keep',
      type: 'number',
      required: false,
      min: 10,
      max: 10000,
      default: 2000,
      advanced: true,
      readOnly: false,
    },
  ],
  contributes: { ambientSlot: 'photos', events: [] },
};

export const googlePhotosManifest: PluginManifest = {
  id: 'google-photos',
  name: 'Google Photos',
  description:
    'Pick albums or photos from Google Photos on your phone; Mantel keeps a copy for the wall.',
  category: 'photos',
  step: 'extras',
  connect: 'oauth',
  optional: true,
  docs: 'weather-commute-photos.md',
  directions: [
    'Press Connect and sign in with the Google account that has the photos. If Google says it has not verified Mantel, press Advanced, then Go to Mantel.',
    'If the next page says it can’t be reached, copy its whole address from the browser bar and paste it in the box that appears here.',
    'Then in Settings, Slideshow, press Pick photos and scan the code with your phone. Choose photos or whole albums in Google Photos and tap Done.',
    'Google no longer lets apps read a whole library, so Mantel shows what you pick. Pick again any time to add more.',
  ],
  fields: [
    {
      key: 'redirectUri',
      label: 'Authorised redirect URI',
      type: 'url',
      required: false,
      advanced: true,
      readOnly: true,
      help: 'Only for your own Google Cloud app (set on the Google Calendar card): add this redirect to it and turn on the Photos Picker API.',
    },
  ],
  contributes: { ambientSlot: 'photos', events: [] },
};

export const photoFolderManifest: PluginManifest = {
  id: 'photo-folder',
  name: 'Photo folder',
  description:
    'Photos from a folder on the Mantel server, such as an Unraid share. New photos appear within a minute.',
  category: 'photos',
  step: 'extras',
  connect: 'fields',
  optional: true,
  docs: 'weather-commute-photos.md',
  directions: [
    'Mount the folder into the Mantel container. On Unraid: edit the Mantel container, Add another Path, Container Path `/photos`, Host Path your share (for example `/mnt/user/Photos`), Access Mode Read Only.',
    'With Docker Compose, add `- /path/to/photos:/photos:ro` under `volumes`.',
    'Leave the folder below as `/photos` (or type where you mounted it) and press Test.',
    'Sub-folders are included, and each one becomes the album name in the caption. iPhone HEIC photos are skipped; export them as JPEG or let Immich or iCloud handle those.',
  ],
  fields: [
    {
      key: 'path',
      label: 'Folder inside the container',
      type: 'text',
      required: true,
      advanced: false,
      readOnly: false,
      default: '/photos',
      placeholder: '/photos',
      help: 'The Container Path you mounted the photos at.',
      pattern: { regex: '^/', message: 'Type a full path starting with /, such as /photos' },
      env: 'PHOTO_FOLDER',
    },
    {
      key: 'limit',
      label: 'Most photos to keep',
      type: 'number',
      required: false,
      min: 10,
      max: 20000,
      default: 3000,
      advanced: true,
      readOnly: false,
      help: 'The newest photos are kept when the folder has more.',
    },
  ],
  contributes: { ambientSlot: 'photos', events: [] },
};
