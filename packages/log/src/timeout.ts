/**
 * `Promise.race([p, timeoutPromise])` leaks a timer that rejects after the race is decided → unhandled
 * rejection (audit NEW-26). This helper clears the timer and never rejects on its own once settled.
 */
export class TimeoutError extends Error {
  constructor(message = 'timeout') { super(message); this.name = 'TimeoutError' }
}

export function withTimeout<T>(p: Promise<T>, ms: number, label = 'operation'): Promise<T> {
  let timer: NodeJS.Timeout | null = null
  const t = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new TimeoutError(`${label} timed out after ${ms} ms`)), ms) })
  return Promise.race([p, t]).finally(() => { if (timer) clearTimeout(timer) })
}

/** Sleep that can be cancelled via AbortSignal. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(t); resolve() }, { once: true })
  })
}
