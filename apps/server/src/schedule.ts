import { DEFAULT_RELOAD_AT, crossed, minutesInZone, type WsEventInput } from '@mantel/shared';
import { log } from './log.js';
import type { SettingsStore } from './settings.js';

const TICK_MS = 20_000;

/**
 * Pushes the screen schedule to every display: `display.sleep` at `offFrom`, `display.wake`
 * at `onAt` and `display.reload` at `reloadAt` (04:00 unless set), in the household timezone.
 * The display also applies the schedule itself; these events keep every screen in step and
 * give kiosk helpers a moment to act on.
 */
export class DisplayScheduler {
  private prev: number | null = null;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly settings: SettingsStore,
    private readonly emit: (event: WsEventInput) => void,
    private readonly now: () => Date = () => new Date(),
  ) {}

  start(): void {
    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  /** One check. Fires every boundary the clock crossed since the previous check. */
  tick(at: Date = this.now()): void {
    const s = this.settings.get();
    const now = minutesInZone(at, s.timezone);
    const prev = this.prev;
    this.prev = now;
    if (prev === null) return;
    const { offFrom, onAt, reloadAt = DEFAULT_RELOAD_AT } = s.schedule;
    if (offFrom !== onAt) {
      if (crossed(prev, now, offFrom))
        this.send({ type: 'display.sleep', payload: { reason: 'schedule' } });
      if (crossed(prev, now, onAt))
        this.send({ type: 'display.wake', payload: { reason: 'schedule' } });
    }
    if (crossed(prev, now, reloadAt)) this.send({ type: 'display.reload', payload: {} });
  }

  private send(event: WsEventInput) {
    log.info(`schedule: ${event.type}`);
    this.emit(event);
  }
}
