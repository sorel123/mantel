import {
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { MOCK_DEVICE_KEY, MOCK_PAIRING_CODE } from '@mantel/shared/fixtures';
import { DeviceOverrides, type Device } from '@mantel/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { kvGet, kvSet, schema, type Db } from './db/index.js';
import { log } from './log.js';

const CODE_TTL_MS = 15 * 60 * 1000;
const hash = (key: string) => createHash('sha256').update(key).digest('hex');

const PIN_KEY = 'admin.pin';
/** After this many wrong PINs in a row, pairing by PIN pauses for `PIN_LOCK_MS`. */
const PIN_MAX_FAILURES = 5;
const PIN_LOCK_MS = 30_000;

interface StoredPin {
  salt: string;
  hash: string;
}

const hashPin = (pin: string, salt: string) =>
  scryptSync(pin, Buffer.from(salt, 'hex'), 32, { N: 16384, r: 8, p: 1 }).toString('hex');

const parseOverrides = (json: string | null): Partial<DeviceOverrides> => {
  if (!json) return {};
  try {
    const parsed = DeviceOverrides.partial().safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
};

/** Only the overrides that are set, so `null` never reaches the display. */
const presentOverrides = (o: Partial<DeviceOverrides>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined)) as {
    look?: Device['look'];
    defaultScreen?: string;
    fit?: Device['fit'];
    scale?: number;
  };

/**
 * Device pairing and key checks. A 6-digit code is printed to the server log and rotates
 * every 15 minutes; `POST /api/pair` exchanges it for a long random device key.
 * In mock mode the code `000000` also works, and requests with no key or `MOCK_DEVICE_KEY` pass.
 */
export class DeviceAuth {
  private code = '';
  private codeExpires = 0;
  private pinFailures = 0;
  private pinLockedUntil = 0;

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
    // A used code is spent.
    this.codeExpires = 0;
    return this.createDevice(name);
  }

  /** Pair with the admin PIN instead of the rotating code. Null when the PIN is wrong or locked out. */
  pairWithPin(pin: string, name = 'Display'): { deviceId: string; deviceKey: string } | null {
    if (!this.verifyPin(pin)) return null;
    return this.createDevice(name);
  }

  private createDevice(name: string) {
    const deviceId = randomUUID();
    const deviceKey = randomBytes(32).toString('base64url');
    this.db
      .insert(schema.devices)
      .values({ id: deviceId, name, keyHash: hash(deviceKey), createdAt: new Date().toISOString() })
      .run();
    log.info(`Paired device "${name}" (${deviceId})`);
    return { deviceId, deviceKey };
  }

  /* ---- admin PIN ---- */

  pinSet(): boolean {
    return kvGet<StoredPin>(this.db, PIN_KEY) !== undefined;
  }

  /** No PIN and no paired display yet: whoever reaches the server first sets things up. */
  firstRun(): boolean {
    if (this.pinSet()) return false;
    return (
      this.db.select({ id: schema.devices.id }).from(schema.devices).limit(1).all().length === 0
    );
  }

  /** Why a `setPin` call may not proceed, or null when it may. */
  pinChangeProblem(currentPin: string | undefined, hasDeviceKey: boolean): string | null {
    if (!this.pinSet()) {
      // Setting the first PIN: on first run anyone may; later (an upgrade) a paired display may.
      if (this.firstRun() || hasDeviceKey) return null;
      return 'pair a display with the code from the server log first, then set the PIN from it';
    }
    if (currentPin === undefined) return 'the current PIN is needed to change it';
    if (!this.verifyPin(currentPin)) return 'the current PIN is wrong';
    return null;
  }

  setPin(pin: string): void {
    const salt = randomBytes(16).toString('hex');
    kvSet(this.db, PIN_KEY, { salt, hash: hashPin(pin, salt) } satisfies StoredPin);
    this.pinFailures = 0;
    log.info('Admin PIN set');
  }

  /** True for the right PIN. Wrong tries count toward a short lockout. In mock mode any PIN works. */
  verifyPin(pin: string): boolean {
    if (this.mock) return true;
    const stored = kvGet<StoredPin>(this.db, PIN_KEY);
    if (!stored) return false;
    if (Date.now() < this.pinLockedUntil) return false;
    const ok = timingSafeEqual(Buffer.from(hashPin(pin, stored.salt)), Buffer.from(stored.hash));
    if (ok) {
      this.pinFailures = 0;
      return true;
    }
    this.pinFailures += 1;
    if (this.pinFailures >= PIN_MAX_FAILURES) {
      this.pinFailures = 0;
      this.pinLockedUntil = Date.now() + PIN_LOCK_MS;
      log.warn('Admin PIN: too many wrong tries; pausing for 30 seconds');
    }
    return false;
  }

  pinLocked(): boolean {
    return Date.now() < this.pinLockedUntil;
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
        ...presentOverrides(parseOverrides(d.overrides)),
      }));
  }

  /** Rename a device; returns it, or null if there is no such device. */
  rename(deviceId: string, name: string, currentId: string | null): Device | null {
    return this.patch(deviceId, { name }, currentId);
  }

  /** Rename and/or change per-display overrides (`null` clears one). Null if there is no such device. */
  patch(
    deviceId: string,
    changes: Partial<DeviceOverrides> & { name?: string },
    currentId: string | null,
  ): Device | null {
    const row = this.db.select().from(schema.devices).where(eq(schema.devices.id, deviceId)).get();
    if (!row) return null;
    const { name, ...overrideChanges } = changes;
    const merged = presentOverrides({ ...parseOverrides(row.overrides), ...overrideChanges });
    this.db
      .update(schema.devices)
      .set({
        ...(name ? { name } : {}),
        overrides: Object.keys(merged).length ? JSON.stringify(merged) : null,
      })
      .where(eq(schema.devices.id, deviceId))
      .run();
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
