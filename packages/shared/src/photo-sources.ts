/**
 * v4 workstream S: more photo sources and the slideshow mixer's contract.
 *
 * Photos now come from several places at once: the iCloud shared album (`photos`), Immich,
 * Google Photos (picked through Google's Picker), and a folder on the server. The server mixes
 * them into one slideshow by per-source weights, slips in "On this day" photos, and sends a
 * caption with each photo (album, date, place) that the display can show or hide.
 *
 * This file does not import models.ts (models.ts imports `PhotoSettings` and `PhotoCaption`
 * from here), so the shared barrel has no cycle.
 */
import { z } from 'zod';

/** The integrations that feed the slideshow. */
export const PhotoSourceId = z.enum(['photos', 'immich', 'google-photos', 'photo-folder']);
export type PhotoSourceId = z.infer<typeof PhotoSourceId>;

/** What the caption line under a photo says. Every part is optional except where it came from. */
export const PhotoCaption = z.object({
  /** The source's short name: "iCloud", "Immich", "Google Photos", "Photo folder". */
  source: z.string(),
  album: z.string().optional(),
  /** When the photo was taken, local wall time `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`, when known. */
  takenAt: z.string().optional(),
  /** "Traverse City, Michigan", when the source knows it. */
  place: z.string().optional(),
  /** Set on "On this day" photos: how many years ago today it was taken. */
  yearsAgo: z.number().int().positive().optional(),
});
export type PhotoCaption = z.infer<typeof PhotoCaption>;

/**
 * How much of the slideshow a source gets. `normal` mixes sources by how many photos each
 * has (square-root weighted, so a small album still turns up); `more` doubles that, `less`
 * halves it, `off` leaves the source out without disconnecting it.
 */
export const PhotoWeight = z.enum(['off', 'less', 'normal', 'more']);
export type PhotoWeight = z.infer<typeof PhotoWeight>;
export const PHOTO_WEIGHT_FACTOR: Record<PhotoWeight, number> = {
  off: 0,
  less: 0.5,
  normal: 1,
  more: 2,
};

/** The slideshow's household settings (`settings.photos`). */
export const PhotoSettings = z.object({
  /** The caption line (album, date, place) over the photo's corner. */
  captions: z.boolean().default(true),
  /** Slip photos taken on today's date in earlier years into the mix, about one in three. */
  onThisDay: z.boolean().default(true),
  /** Per source; a missing source is `normal`. */
  weights: z.record(z.string(), PhotoWeight).default({}),
});
export type PhotoSettings = z.infer<typeof PhotoSettings>;
export const DEFAULT_PHOTO_SETTINGS: PhotoSettings = {
  captions: true,
  onThisDay: true,
  weights: {},
};

/** One source as the slideshow settings see it. */
export const PhotoSourceInfo = z.object({
  id: PhotoSourceId,
  name: z.string(),
  /** Photos ready to show. */
  count: z.number().int().nonnegative(),
  /** Of those, taken on today's date in an earlier year. */
  onThisDay: z.number().int().nonnegative(),
  weight: PhotoWeight,
  /** `syncing` while new photos are being downloaded; `not_set_up` when the plugin has no values yet. */
  state: z.enum(['ready', 'syncing', 'not_set_up', 'error', 'disabled']),
  lastSync: z.string().nullable(),
  /** One sentence for a problem, written for a person. */
  error: z.string().nullable(),
});
export type PhotoSourceInfo = z.infer<typeof PhotoSourceInfo>;

export const PhotoSourcesResponse = z.object({ sources: z.array(PhotoSourceInfo) });
export type PhotoSourcesResponse = z.infer<typeof PhotoSourcesResponse>;

/** A Google Photos picking session: open `pickerUri` on a phone, choose photos, press Done. */
export const GooglePickSession = z.object({
  id: z.string(),
  pickerUri: z.string(),
  expiresAt: z.string(),
});
export type GooglePickSession = z.infer<typeof GooglePickSession>;

export const GooglePickStatus = z.object({
  /** `waiting` for the person to finish picking; `saving` while Mantel downloads; then `done`. */
  state: z.enum(['waiting', 'saving', 'done', 'expired', 'error']),
  /** Photos saved from this session so far. */
  saved: z.number().int().nonnegative(),
  message: z.string().optional(),
});
export type GooglePickStatus = z.infer<typeof GooglePickStatus>;

export const GoogleClearResponse = z.object({ removed: z.number().int().nonnegative() });

const NoQuery = z.object({});
const NoBody = z.undefined();

interface PhotoRoute {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query: z.ZodType;
  body: z.ZodType;
  response: z.ZodType | null;
  auth: boolean;
}
const route = <const R extends PhotoRoute>(def: R) => def;

export const photoSourceRoutes = {
  /** Every photo source with its count, weight and state, for Settings, Slideshow. */
  photoSources: route({
    method: 'GET',
    path: '/photo-sources',
    query: NoQuery,
    body: NoBody,
    response: PhotoSourcesResponse,
    auth: true,
  }),
  /** Start a Google Photos picking session. Needs Google Photos connected. */
  googlePhotosPick: route({
    method: 'POST',
    path: '/photo-sources/google/pick',
    query: NoQuery,
    body: NoBody,
    response: GooglePickSession,
    auth: true,
  }),
  /** Poll a picking session; when the person presses Done, Mantel downloads what they picked. */
  googlePhotosPickStatus: route({
    method: 'GET',
    path: '/photo-sources/google/pick/:id',
    query: NoQuery,
    body: NoBody,
    response: GooglePickStatus,
    auth: true,
  }),
  /** Forget every photo picked from Google Photos (the photos stay in Google Photos). */
  googlePhotosClear: route({
    method: 'DELETE',
    path: '/photo-sources/google/photos',
    query: NoQuery,
    body: NoBody,
    response: GoogleClearResponse,
    auth: true,
  }),
  /** Google's sign-in redirect lands here when the browser is on the computer running Mantel. */
  googlePhotosCallback: route({
    method: 'GET',
    path: '/photo-sources/google/callback',
    query: z.object({
      code: z.string().optional(),
      state: z.string().optional(),
      error: z.string().optional(),
    }),
    body: NoBody,
    response: null,
    auth: false,
  }),
} as const;

/** How a caption reads: "Lake Michigan · Traverse City · July 2019", or "3 years ago today · ...". */
export function captionText(caption: PhotoCaption, opts: { locale?: string } = {}): string {
  const parts: string[] = [];
  if (caption.yearsAgo)
    parts.push(caption.yearsAgo === 1 ? 'A year ago today' : `${caption.yearsAgo} years ago today`);
  if (caption.album) parts.push(caption.album);
  if (caption.place) parts.push(caption.place);
  if (caption.takenAt && !caption.yearsAgo) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(caption.takenAt);
    if (m) {
      const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
      parts.push(
        d.toLocaleDateString(opts.locale ?? 'en-US', {
          month: 'long',
          year: 'numeric',
          timeZone: 'UTC',
        }),
      );
    }
  }
  return parts.join(' · ');
}
