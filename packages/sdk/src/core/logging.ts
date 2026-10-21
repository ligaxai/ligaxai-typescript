/**
 * Minimal leveled logger. Level comes from the `logLevel` client option, else the
 * `LIGAX_LOG` env var, else `warn`. The default sink is `console`; pass `logger` to route
 * into pino/winston/etc.
 *
 * Request-level logs pass through `redactHeaders` so an `Authorization` value is never written
 * anywhere, even at `debug`.
 */

export type LogLevel = 'off' | 'error' | 'warn' | 'info' | 'debug';

export interface Logger {
  error(message: string, ...rest: unknown[]): void;
  warn(message: string, ...rest: unknown[]): void;
  info(message: string, ...rest: unknown[]): void;
  debug(message: string, ...rest: unknown[]): void;
}

const LEVELS: Record<LogLevel, number> = { off: 0, error: 1, warn: 2, info: 3, debug: 4 };

export function parseLogLevel(value: string | undefined, source: string): LogLevel | undefined {
  if (!value) return undefined;
  if (value in LEVELS) return value as LogLevel;
  // A typo in an env var should be loud, not silently mean "off".
  console.warn(`${source} must be one of ${Object.keys(LEVELS).join(', ')}; got ${value}`);
  return undefined;
}

const SENSITIVE_HEADERS = new Set(['authorization', 'x-api-key', 'cookie', 'set-cookie']);

export function redactHeaders(headers: HeadersInit | Headers | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  const iter = headers instanceof Headers ? headers : new Headers(headers);
  iter.forEach((value, key) => {
    out[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? '***' : value;
  });
  return out;
}

export function createLogger(level: LogLevel, sink: Logger = console): Logger {
  const threshold = LEVELS[level];
  const gate =
    (lvl: LogLevel, fn: (message: string, ...rest: unknown[]) => void) =>
    (message: string, ...rest: unknown[]) => {
      if (LEVELS[lvl] <= threshold) fn.call(sink, `[ligaxai-typescript] ${message}`, ...rest);
    };
  return {
    error: gate('error', sink.error),
    warn: gate('warn', sink.warn),
    info: gate('info', sink.info),
    debug: gate('debug', sink.debug),
  };
}
