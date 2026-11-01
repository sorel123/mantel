import { VERSION } from './version.js';
import type { UpdateCheckResponse } from '@mantel/shared';

const TTL_MS = 6 * 60 * 60 * 1000;

/** `v1.2.3` or `1.2.3-beta` to [1,2,3]; null when it is not a version. */
export function parseVersion(v: string): number[] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i]! !== b[i]!) return a[i]! > b[i]!;
  return false;
}

/** Reads the latest GitHub release at most every six hours; never throws. */
export class UpdateChecker {
  private cached: { at: number; value: UpdateCheckResponse } | null = null;

  constructor(private readonly opts: { enabled: boolean; repo: string; fetch?: typeof fetch }) {}

  async check(): Promise<UpdateCheckResponse> {
    const none: UpdateCheckResponse = {
      current: VERSION,
      checked: false,
      latest: null,
      available: false,
      url: null,
      notes: null,
    };
    if (!this.opts.enabled) return none;
    if (this.cached && Date.now() - this.cached.at < TTL_MS) return this.cached.value;
    try {
      const res = await (this.opts.fetch ?? fetch)(
        `https://api.github.com/repos/${this.opts.repo}/releases/latest`,
        {
          headers: { accept: 'application/vnd.github+json', 'user-agent': 'mantel-update-check' },
          signal: AbortSignal.timeout(8000),
        },
      );
      // 404 means no release yet: checked, nothing newer.
      if (res.status === 404) return this.remember({ ...none, checked: true });
      if (!res.ok) return none;
      const r = (await res.json()) as { tag_name?: string; html_url?: string; body?: string };
      const latest = r.tag_name?.replace(/^v/, '') ?? null;
      return this.remember({
        current: VERSION,
        checked: true,
        latest,
        available: latest !== null && isNewer(latest, VERSION),
        url: r.html_url ?? null,
        notes: r.body ? r.body.slice(0, 1500) : null,
      });
    } catch {
      return none;
    }
  }

  private remember(value: UpdateCheckResponse) {
    this.cached = { at: Date.now(), value };
    return value;
  }
}
