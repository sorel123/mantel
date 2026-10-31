/**
 * Weather extras from sources other than Open-Meteo: NWS alerts (US only, no key) and the
 * Google Pollen API (needs a Maps Platform key), used where Open-Meteo has no pollen.
 */
import type { WeatherSnapshot } from '@mantel/shared';
import { z } from 'zod';
import { VERSION } from '../../version.js';

type Alert = WeatherSnapshot['alerts'][number];
type Pollen = NonNullable<WeatherSnapshot['pollen']>;

/* ---------- NWS alerts ---------- */

export const NWS_ALERTS_URL = 'https://api.weather.gov/alerts/active';

const NwsJson = z.object({
  features: z.array(
    z.object({
      id: z.string().optional(),
      properties: z.object({
        id: z.string().optional(),
        event: z.string().nullable().optional(),
        severity: z.string().nullable().optional(),
        headline: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
        onset: z.string().nullable().optional(),
        effective: z.string().nullable().optional(),
        ends: z.string().nullable().optional(),
        expires: z.string().nullable().optional(),
      }),
    }),
  ),
});

const SEVERITIES = ['minor', 'moderate', 'severe', 'extreme'] as const;
const RANK = { extreme: 0, severe: 1, moderate: 2, minor: 3, unknown: 4 } as const;

export function nwsAlertsUrl(latitude: number, longitude: number): string {
  // NWS rejects points with more than four decimals.
  return `${NWS_ALERTS_URL}?point=${latitude.toFixed(4)},${longitude.toFixed(4)}`;
}

export function nwsHeaders(contact?: string): Record<string, string> {
  return {
    accept: 'application/geo+json',
    'user-agent': `mantel/${VERSION} (${contact || 'https://github.com/sorel123/mantel'})`,
  };
}

const isoOrNull = (s: string | null | undefined) =>
  s && z.iso.datetime({ offset: true }).safeParse(s).success ? s : null;

/** Active alerts, most severe first. */
export function normaliseNws(raw: unknown, now: Date): Alert[] {
  const json = NwsJson.parse(raw);
  const alerts: Alert[] = [];
  for (const f of json.features) {
    const p = f.properties;
    const starts = isoOrNull(p.onset) ?? isoOrNull(p.effective);
    const ends = isoOrNull(p.ends) ?? isoOrNull(p.expires);
    if (!starts || !p.event) continue;
    if (ends && new Date(ends) <= now) continue;
    const sev = (p.severity ?? '').toLowerCase();
    alerts.push({
      id: p.id ?? f.id ?? `${p.event}-${starts}`,
      event: p.event,
      severity: (SEVERITIES as readonly string[]).includes(sev)
        ? (sev as Alert['severity'])
        : 'unknown',
      headline: p.headline ?? p.event,
      description: (p.description ?? '').trim(),
      starts,
      ends,
    });
  }
  return alerts.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}

/* ---------- Google Pollen ---------- */

export const GOOGLE_POLLEN_URL = 'https://pollen.googleapis.com/v1/forecast:lookup';

const GooglePollenJson = z.object({
  dailyInfo: z
    .array(
      z.object({
        pollenTypeInfo: z
          .array(
            z.object({
              code: z.string(),
              indexInfo: z.object({ value: z.number() }).optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});

export function googlePollenUrl(latitude: number, longitude: number, key: string): string {
  const params = new URLSearchParams({
    key,
    'location.latitude': String(latitude),
    'location.longitude': String(longitude),
    days: '1',
    plantsDescription: '0',
  });
  return `${GOOGLE_POLLEN_URL}?${params}`;
}

/** Universal Pollen Index 0-5 to a level. Out-of-season types carry no index and count as none. */
const upiLevel = (v: number | undefined): Pollen['tree'] => {
  if (v === undefined || v < 1) return 'none';
  if (v < 3) return 'low';
  if (v < 4) return 'moderate';
  if (v < 5) return 'high';
  return 'very_high';
};

export function normaliseGooglePollen(raw: unknown): Pollen | null {
  const types = GooglePollenJson.parse(raw).dailyInfo?.[0]?.pollenTypeInfo;
  if (!types?.length) return null;
  const value = (code: string) => types.find((t) => t.code === code)?.indexInfo?.value;
  return {
    tree: upiLevel(value('TREE')),
    grass: upiLevel(value('GRASS')),
    weed: upiLevel(value('WEED')),
  };
}
