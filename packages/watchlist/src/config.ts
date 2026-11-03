function num(name: string, fallback: number): number {
  const v = process.env[name]
  const n = v ? Number(v) : NaN
  return Number.isFinite(n) ? n : fallback
}

export const WATCHLIST_CONFIG = {
  /** Pay floor (INR, annual). Companies with confident evidence below this are demoted to dormant. */
  payFloorInr: num('PAY_FLOOR_INR', 3_000_000),
  payFloorConfidence: num('PAY_FLOOR_CONFIDENCE', 0.6),
  /** Consecutive successful polls without a posting before it is marked gone. */
  goneAfterMissingPolls: num('GONE_AFTER_MISSING_POLLS', 2),
  /** If a board's posting count drops by more than this fraction in one poll, closures are suspended. */
  suspectDropFraction: num('SUSPECT_DROP_FRACTION', 0.5),
  /** Sightings retention after gone_at (days). */
  sightingRetentionDays: num('SIGHTING_RETENTION_DAYS', 365),
  fetchRunRetentionDays: num('FETCH_RUN_RETENTION_DAYS', 30),
  /** v3 derived artifacts: match reports (non-tailored versions) and unused tailored versions (days). */
  reportRetentionDays: num('REPORT_RETENTION_DAYS', 180),
  tailoredVersionRetentionDays: num('TAILORED_VERSION_RETENTION_DAYS', 365),
  pruneClosedJobs: (process.env.PRUNE_CLOSED_JOBS ?? 'false') === 'true',
  /** Vectors of closed jobs are dropped after this many days (rows stay) — audit NEW-08. */
  closedJobVectorRetentionDays: num('CLOSED_JOB_VECTOR_RETENTION_DAYS', 30),
  /** Liveness ladder for aggregator-only jobs. */
  livenessMinAgeDays: num('LIVENESS_MIN_AGE_DAYS', 14),
  livenessRecheckDays: num('LIVENESS_RECHECK_DAYS', 7),
  livenessAgeOutDays: num('LIVENESS_AGE_OUT_DAYS', 60),
  livenessDailyBudget: num('LIVENESS_DAILY_BUDGET', 300),
  /** Dispatcher batch size. */
  dispatchBatch: num('DISPATCH_BATCH', 200),
  /** Tier intervals in minutes by cost class. */
  intervals: {
    hot: { cheap: 5, medium: 15, expensive: 60 },
    warm: { cheap: 30, medium: 60, expensive: 180 },
    cold: { cheap: 360, medium: 720, expensive: 1440 },
    dormant: { cheap: 10080, medium: 10080, expensive: 20160 },
  } as Record<'hot' | 'warm' | 'cold' | 'dormant', Record<'cheap' | 'medium' | 'expensive', number>>,
  /** Board size scaling: interval *= 1 + postings / sizeScale */
  sizeScale: num('BOARD_SIZE_SCALE', 250),
  jitterFraction: 0.2,
}

export function intervalMinutesFor(tier: 'hot' | 'warm' | 'cold' | 'dormant', cost: 'cheap' | 'medium' | 'expensive', postings: number): number {
  const base = WATCHLIST_CONFIG.intervals[tier][cost]
  return base * (1 + Math.max(0, postings) / WATCHLIST_CONFIG.sizeScale)
}

export function nextPollAtFor(tier: 'hot' | 'warm' | 'cold' | 'dormant', cost: 'cheap' | 'medium' | 'expensive', postings: number, phaseSeed: string): Date {
  const minutes = intervalMinutesFor(tier, cost, postings)
  // deterministic phase offset from the board id so boards of one tier are spread across the window
  let h = 0
  for (const ch of phaseSeed) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const phase = (h % 1000) / 1000 // 0..1
  const jitter = (Math.random() * 2 - 1) * WATCHLIST_CONFIG.jitterFraction
  const ms = minutes * 60_000 * (1 + jitter) * (0.5 + phase) // 0.5x..1.5x of interval
  return new Date(Date.now() + Math.max(60_000, ms))
}
