import PQueue from 'p-queue'

class DomainRateLimiter {
  private queues = new Map<string, PQueue>()

  schedule<T>(domain: string, delayMs: number, fn: () => Promise<T>): Promise<T> {
    if (!this.queues.has(domain)) {
      this.queues.set(
        domain,
        new PQueue({ concurrency: 1, interval: delayMs, intervalCap: 1 })
      )
    }
    return this.queues.get(domain)!.add(fn) as Promise<T>
  }
}

export const rateLimiter = new DomainRateLimiter()
