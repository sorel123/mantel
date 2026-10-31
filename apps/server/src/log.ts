const levels = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof levels;

let threshold: number = levels.info;

export interface LogEntry {
  at: string;
  level: Level;
  message: string;
}

/** The last lines, oldest first, for `/api/health/details`. Kept regardless of the level filter. */
const RING_SIZE = 50;
const ring: LogEntry[] = [];

export function logTail(): LogEntry[] {
  return ring.slice();
}

export function setLogLevel(level: Level) {
  threshold = levels[level];
}

function write(level: Level, msg: string, extra?: Record<string, unknown>) {
  const at = new Date().toISOString();
  if (level !== 'debug') {
    ring.push({ at, level, message: extra ? `${msg} ${JSON.stringify(extra)}` : msg });
    if (ring.length > RING_SIZE) ring.splice(0, ring.length - RING_SIZE);
  }
  if (levels[level] < threshold) return;
  const line = `${at} ${level.toUpperCase().padEnd(5)} ${msg}`;
  const out = extra ? `${line} ${JSON.stringify(extra)}` : line;
  if (level === 'error' || level === 'warn') console.error(out);
  else console.log(out);
}

export const log = {
  debug: (m: string, x?: Record<string, unknown>) => write('debug', m, x),
  info: (m: string, x?: Record<string, unknown>) => write('info', m, x),
  warn: (m: string, x?: Record<string, unknown>) => write('warn', m, x),
  error: (m: string, x?: Record<string, unknown>) => write('error', m, x),
};
