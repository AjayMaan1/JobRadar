/**
 * Structured, dependency-free logger (audit NEW-06). One JSON line per event in production
 * (`LOG_FORMAT=json`, default when NODE_ENV=production), human-readable otherwise. Bindings (app, queue, taskId,
 * userId, jobId…) are attached with `log.child({...})`. Values under sensitive keys are redacted so resume text,
 * prompts, passwords and tokens never reach stdout even by accident.
 *
 * Call signature is console-compatible on purpose (`log.warn('msg', err)` / `log.info('msg', { jobId })`), so the
 * migration from console.* is mechanical.
 */
export type Level = 'debug' | 'info' | 'warn' | 'error' | 'silent'
const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 }

/** Keys whose values are never logged (matched case-insensitively, anywhere in the object tree). */
export const REDACT_KEYS = new Set([
  'password', 'passwordhash', 'token', 'tokenhash', 'authorization', 'cookie', 'set-cookie', 'secret', 'apikey', 'api_key',
  // PII / document content
  'content', 'rawtext', 'raw_text', 'description', 'prompt', 'system', 'user', 'resume', 'text', 'body', 'answer', 'answers', 'after', 'before',
  'email', 'phone', 'address', 'headline', 'about', 'summary', 'highlights', 'coverNote', 'cover_note', 'vector',
])
const REDACTED = '[redacted]'
const MAX_DEPTH = 6

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value
  if (value instanceof Error) return serializeError(value)
  if (Array.isArray(value)) return depth >= MAX_DEPTH ? '[array]' : value.slice(0, 50).map((v) => redact(v, depth + 1))
  if (typeof value === 'object') {
    if (depth >= MAX_DEPTH) return '[object]'
    if (value instanceof Date) return value.toISOString()
    if (Buffer.isBuffer(value)) return `[buffer ${value.length}b]`
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = REDACT_KEYS.has(k.toLowerCase()) ? (v === null || v === undefined ? v : REDACTED) : redact(v, depth + 1)
    return out
  }
  if (typeof value === 'string' && value.length > 2000) return `${value.slice(0, 2000)}…[+${value.length - 2000}]`
  return value
}

export function serializeError(err: Error): Record<string, unknown> {
  const e = err as Error & { code?: unknown; status?: unknown; cause?: unknown }
  return {
    name: err.name,
    message: err.message.length > 1000 ? `${err.message.slice(0, 1000)}…` : err.message,
    ...(e.code !== undefined ? { code: e.code } : {}),
    ...(e.status !== undefined ? { status: e.status } : {}),
    ...(process.env.NODE_ENV !== 'production' && err.stack ? { stack: err.stack.split('\n').slice(0, 8).join('\n') } : {}),
    ...(e.cause instanceof Error ? { cause: serializeError(e.cause) } : {}),
  }
}

export interface LogRecord { level: Level; time: string; msg: string; [k: string]: unknown }
export type Sink = (rec: LogRecord, line: string) => void

interface State { level: Level; format: 'json' | 'pretty'; sink: Sink | null; hooks: Array<(rec: LogRecord) => void> }
const state: State = {
  level: (process.env.LOG_LEVEL as Level) in LEVELS ? (process.env.LOG_LEVEL as Level) : 'info',
  format: process.env.LOG_FORMAT === 'json' || (process.env.LOG_FORMAT !== 'pretty' && process.env.NODE_ENV === 'production') ? 'json' : 'pretty',
  sink: null,
  hooks: [],
}

export function configureLog(opts: { level?: Level; format?: 'json' | 'pretty'; sink?: Sink | null }): void {
  if (opts.level) state.level = opts.level
  if (opts.format) state.format = opts.format
  if (opts.sink !== undefined) state.sink = opts.sink
}
/** Observe every record (metrics counters, error trackers). Hooks must never throw. */
export function onLog(hook: (rec: LogRecord) => void): () => void {
  state.hooks.push(hook)
  return () => { state.hooks = state.hooks.filter((h) => h !== hook) }
}

const COLORS: Record<Level, string> = { debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m', silent: '' }

function format(rec: LogRecord): string {
  if (state.format === 'json') return JSON.stringify(rec)
  const { level, time, msg, ...rest } = rec
  const ctx = Object.keys(rest).length ? ' ' + JSON.stringify(rest) : ''
  return `${time.slice(11, 19)} ${COLORS[level]}${level.toUpperCase().padEnd(5)}\x1b[0m ${msg}${ctx}`
}

function emit(level: Level, bindings: Record<string, unknown>, args: unknown[]): void {
  if (LEVELS[level] < LEVELS[state.level]) return
  const parts: string[] = []
  const fields: Record<string, unknown> = { ...bindings }
  for (const a of args) {
    if (a instanceof Error) fields.err = serializeError(a)
    else if (typeof a === 'object' && a !== null) Object.assign(fields, redact(a) as Record<string, unknown>)
    else parts.push(typeof a === 'string' ? a : String(a))
  }
  const rec: LogRecord = { level, time: new Date().toISOString(), msg: parts.join(' '), ...fields }
  const line = format(rec)
  for (const h of state.hooks) { try { h(rec) } catch { /* hooks never break logging */ } }
  if (state.sink) { state.sink(rec, line); return }
  ;(level === 'error' ? process.stderr : process.stdout).write(line + '\n')
}

export interface Logger {
  debug(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
  /** console.log alias (info). */
  log(...args: unknown[]): void
  child(bindings: Record<string, unknown>): Logger
  readonly bindings: Record<string, unknown>
}

export function createLogger(bindings: Record<string, unknown> = {}): Logger {
  return {
    bindings,
    debug: (...a) => emit('debug', bindings, a),
    info: (...a) => emit('info', bindings, a),
    warn: (...a) => emit('warn', bindings, a),
    error: (...a) => emit('error', bindings, a),
    log: (...a) => emit('info', bindings, a),
    child: (b) => createLogger({ ...bindings, ...b }),
  }
}

/** Root logger. Prefer `log.child({ queue, taskId })` inside workers. */
export const log: Logger = createLogger(process.env.APP_NAME ? { app: process.env.APP_NAME } : {})
