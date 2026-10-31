import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { MOCK_DEVICE_KEY, MOCK_PAIRING_CODE } from '@mantel/shared/fixtures';
import type { Device } from '@mantel/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { schema, type Db } from './db/index.js';
import { log } from './log.js';

const CODE_TTL_MS = 15 * 60 * 1000;
const hash = (key: string) => createHash('sha256').update(key).digest('hex');

/**
 * Device pairing and key checks. A 6-digit code is printed to the server log and rotates
 * every 15 minutes; `POST /api/pair` exchanges it for a long random device key.
 * In mock mode the code `000000` also works, and requests with no key or `MOCK_DEVICE_KEY` pass.
 */
export class DeviceAuth {
  private code = '';
  private codeExpires = 0;

  constructor(
    private readonly db: Db,
    private readonly mock: boolean,
  ) {}

  /** The current pairing code, rotating it if it expired. */
  currentCode(): string {
    if (Date.now() >= this.codeExpires) {
      this.code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      this.codeExpires = Date.now() + CODE_TTL_MS;
      log.info(`Pairing code: ${this.code} (valid 15 minutes)`);
    }
    return this.code;
  }

  /** The current code and when it expires, so a paired display can pair another. */
  pairingCode(): { code: string; expiresAt: Date } {
    const code = this.currentCode();
    return { code, expiresAt: new Date(this.codeExpires) };
  }

  pair(code: string, name = 'Display'): { deviceId: string; deviceKey: string } | null {
    const current = this.currentCode();
    const ok =
      (code.length === current.length &&
        timingSafeEqual(Buffer.from(code), Buffer.from(current))) ||
      (this.mock && code === MOCK_PAIRING_CODE);
    if (!ok) return null;
    const deviceId = randomUUID();
    const deviceKey = randomBytes(32).toString('base64url');
    this.db
      .insert(schema.devices)
      .values({ id: deviceId, name, keyHash: hash(deviceKey), createdAt: new Date().toISOString() })
      .run();
    // A used code is spent.
    this.codeExpires = 0;
    log.info(`Paired device "${name}" (${deviceId})`);
    return { deviceId, deviceKey };
  }

  /** The device id for a valid key, or null. */
  verify(key: string | null | undefined): string | null {
    // Mock mode lets an unpaired display in, so `pnpm dev` needs no pairing step.
    if (this.mock && (!key || key === MOCK_DEVICE_KEY)) return 'dev-mock';
    if (!key) return null;
    const row = this.db
      .select()
      .from(schema.devices)
      .where(and(eq(schema.devices.keyHash, hash(key)), isNull(schema.devices.revokedAt)))
      .get();
    if (!row) return null;
    this.db
      .update(schema.devices)
      .set({ lastSeenAt: new Date().toISOString() })
      .where(eq(schema.devices.id, row.id))
      .run();
    return row.id;
  }

  /** Every paired display, newest first, revoked ones included. */
  list(currentId: string | null): Device[] {
    return this.db
      .select()
      .from(schema.devices)
      .orderBy(desc(schema.devices.createdAt))
      .all()
      .map((d) => ({
        id: d.id,
        name: d.name,
        createdAt: d.createdAt,
        lastSeenAt: d.lastSeenAt,
        revokedAt: d.revokedAt,
        current: d.id === currentId,
      }));
  }

  /** Rename a device; returns it, or null if there is no such device. */
  rename(deviceId: string, name: string, currentId: string | null): Device | null {
    this.db.update(schema.devices).set({ name }).where(eq(schema.devices.id, deviceId)).run();
    return this.list(currentId).find((d) => d.id === deviceId) ?? null;
  }

  /** Revoke a device key. False if there is no such device or it was already revoked. */
  revoke(deviceId: string): boolean {
    const result = this.db
      .update(schema.devices)
      .set({ revokedAt: new Date().toISOString() })
      .where(and(eq(schema.devices.id, deviceId), isNull(schema.devices.revokedAt)))
      .run();
    if (result.changes > 0) log.info(`Revoked device ${deviceId}`);
    return result.changes > 0;
  }
}
