export { log, createLogger, configureLog, onLog, redact, serializeError, REDACT_KEYS } from './logger.js'
export type { Logger, Level, LogRecord, Sink } from './logger.js'
export { metrics, m, Registry, Counter, Gauge, Histogram } from './metrics.js'
export { withTimeout, sleep, TimeoutError } from './timeout.js'
import { onLog } from './logger.js'
import { m } from './metrics.js'
// Every log record is a metric sample too (alert on error rate without a log pipeline). Guarded so Next.js dev
// module re-evaluation does not register the hook twice.
const g = globalThis as unknown as { __jobradarLogHook?: boolean }
if (!g.__jobradarLogHook) { g.__jobradarLogHook = true; onLog((rec) => m.logEvents.inc({ level: rec.level })) }
