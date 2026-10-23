/**
 * Application log. Runs from the first line of main.ts, keeps the last entries in a ring buffer
 * and is exported with the debug package ("Debug-Paket") for troubleshooting with Claude.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  /** Wall clock (ms since epoch). */
  time: number;
  /** performance.now() at logging time. */
  perf: number;
  level: LogLevel;
  source: string;
  message: string;
  data?: unknown;
}

const MAX_ENTRIES = 4000;

function sanitize(value: unknown, depth = 0): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack?.split('\n').slice(0, 12).join('\n') };
  }
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'string' && value.length > 4000) return value.slice(0, 4000) + '…';
    if (typeof value === 'bigint') return value.toString();
    return value;
  }
  if (depth > 4) return '[…]';
  if (ArrayBuffer.isView(value)) return `[${value.constructor.name} ${(value as ArrayBufferView).byteLength} bytes]`;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitize(v, depth + 1));
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (n++ > 50) {
      out['…'] = 'gekürzt';
      break;
    }
    out[k] = sanitize(v, depth + 1);
  }
  return out;
}

class Logger {
  private entries: LogEntry[] = [];
  private listeners = new Set<(e: LogEntry) => void>();
  private installed = false;
  counts = { debug: 0, info: 0, warn: 0, error: 0 };

  log(level: LogLevel, source: string, message: string, data?: unknown): void {
    const entry: LogEntry = {
      time: Date.now(),
      perf: typeof performance !== 'undefined' ? performance.now() : 0,
      level,
      source,
      message,
      data: data === undefined ? undefined : sanitize(data),
    };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    this.counts[level]++;
    for (const l of this.listeners) {
      try {
        l(entry);
      } catch {
        /* listeners must not break logging */
      }
    }
  }

  debug(source: string, message: string, data?: unknown): void {
    this.log('debug', source, message, data);
  }
  info(source: string, message: string, data?: unknown): void {
    this.log('info', source, message, data);
  }
  warn(source: string, message: string, data?: unknown): void {
    this.log('warn', source, message, data);
  }
  error(source: string, message: string, data?: unknown): void {
    this.log('error', source, message, data);
  }

  all(): readonly LogEntry[] {
    return this.entries;
  }

  subscribe(fn: (e: LogEntry) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Captures uncaught errors, unhandled promise rejections and console warnings/errors. */
  installGlobalHandlers(): void {
    if (this.installed || typeof window === 'undefined') return;
    this.installed = true;
    window.addEventListener('error', (ev) => {
      if (ev.message?.startsWith('ResizeObserver loop')) return;
      this.error('window', ev.message || 'Unbekannter Fehler', {
        file: ev.filename,
        line: ev.lineno,
        column: ev.colno,
        error: ev.error,
      });
    });
    window.addEventListener('unhandledrejection', (ev) => {
      this.error('promise', 'Unbehandelte Promise-Ablehnung', { reason: ev.reason });
    });
    const origError = console.error.bind(console);
    const origWarn = console.warn.bind(console);
    console.error = (...args: unknown[]) => {
      this.log('error', 'console', args.map(String).join(' ').slice(0, 2000));
      origError(...args);
    };
    console.warn = (...args: unknown[]) => {
      this.log('warn', 'console', args.map(String).join(' ').slice(0, 2000));
      origWarn(...args);
    };
  }
}

export const log = new Logger();

export function formatLogLine(e: LogEntry, startTime: number): string {
  const ts = new Date(e.time).toISOString();
  const rel = ((e.time - startTime) / 1000).toFixed(3).padStart(9);
  const data = e.data === undefined ? '' : ' ' + JSON.stringify(e.data);
  return `${ts} +${rel}s ${e.level.toUpperCase().padEnd(5)} [${e.source}] ${e.message}${data}`;
}
