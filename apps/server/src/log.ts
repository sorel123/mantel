const levels = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof levels;

let threshold: number = levels.info;

export function setLogLevel(level: Level) {
  threshold = levels[level];
}

function write(level: Level, msg: string, extra?: Record<string, unknown>) {
  if (levels[level] < threshold) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${msg}`;
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
