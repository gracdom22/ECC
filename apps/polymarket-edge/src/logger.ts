import { redactUrl } from './clients/http.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

const SECRET_KEY_PATTERN = /(api_?key|secret|password|authorization|private)/i;

function scrub(fields: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!fields) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (SECRET_KEY_PATTERN.test(k)) out[k] = '[REDACTED]';
    else if (v instanceof Error) out[k] = redactUrl(v.message);
    else if (typeof v === 'string') out[k] = redactUrl(v);
    else out[k] = v;
  }
  return out;
}

export function createLogger(minLevel: LogLevel = 'info'): Logger {
  const order: LogLevel[] = ['debug', 'info', 'warn', 'error'];
  const log = (level: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    if (order.indexOf(level) < order.indexOf(minLevel)) return;
    const line = JSON.stringify({ ts: new Date().toISOString(), level, msg: redactUrl(msg), ...scrub(fields) });
    if (level === 'error' || level === 'warn') console.error(line);
    else console.log(line);
  };
  return {
    debug: (m, f) => log('debug', m, f),
    info: (m, f) => log('info', m, f),
    warn: (m, f) => log('warn', m, f),
    error: (m, f) => log('error', m, f),
  };
}

export const silentLogger: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
