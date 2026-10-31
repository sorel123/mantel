import type { PluginManifest } from '@mantel/shared';

export const manifest: PluginManifest = {
  id: 'photos',
  name: 'Photos',
  description: 'A shared iCloud album plays on the Ambient screen.',
  category: 'photos',
  step: 'extras',
  connect: 'fields',
  optional: true,
  docs: 'weather-commute-photos.md',
  directions: [
    'In Photos, open the shared album, tap the people icon and turn on Public Website.',
    'Copy the link it shows and paste it below.',
  ],
  fields: [
    {
      key: 'albumUrl',
      label: 'Shared album link',
      type: 'url',
      required: true,
      advanced: false,
      readOnly: false,
      placeholder: 'https://www.icloud.com/sharedalbum/#B0a...',
      env: 'ICLOUD_SHARED_ALBUM_URL',
    },
    {
      key: 'limit',
      label: 'Most photos to keep',
      type: 'number',
      required: false,
      min: 10,
      max: 5000,
      default: 500,
      advanced: true,
      readOnly: false,
      env: 'PHOTO_LIMIT',
    },
  ],
  contributes: { ambientSlot: 'photos', events: [] },
};
