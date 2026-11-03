export interface HostPolicySeed {
  host: string
  maxConcurrency: number
  minIntervalMs: number
  burst: number
  dailyBudget: number
  probeBudgetPerDay: number
  respectRobots?: boolean
  notes?: string
}

export const HOST_POLICIES: HostPolicySeed[] = [
  { host: 'boards-api.greenhouse.io', maxConcurrency: 2, minIntervalMs: 1000, burst: 3, dailyBudget: 20000, probeBudgetPerDay: 300, notes: 'Public board API; supports ETag' },
  { host: 'api.lever.co',             maxConcurrency: 2, minIntervalMs: 1000, burst: 3, dailyBudget: 20000, probeBudgetPerDay: 300, notes: 'Public postings API; list includes descriptions (big)' },
  { host: 'api.ashbyhq.com',          maxConcurrency: 1, minIntervalMs: 2000, burst: 2, dailyBudget: 10000, probeBudgetPerDay: 200, notes: 'Posting API' },
  { host: 'apply.workable.com',       maxConcurrency: 1, minIntervalMs: 2000, burst: 2, dailyBudget: 10000, probeBudgetPerDay: 200 },
  { host: 'api.smartrecruiters.com',  maxConcurrency: 2, minIntervalMs: 1000, burst: 3, dailyBudget: 10000, probeBudgetPerDay: 200 },
  { host: '*.myworkdayjobs.com',      maxConcurrency: 1, minIntervalMs: 5000, burst: 1, dailyBudget: 500,   probeBudgetPerDay: 20, notes: 'Per-tenant host; scoped queries only' },
  { host: 'hn.algolia.com',           maxConcurrency: 1, minIntervalMs: 1000, burst: 2, dailyBudget: 2000,  probeBudgetPerDay: 0 },
  { host: 'raw.githubusercontent.com', maxConcurrency: 1, minIntervalMs: 1000, burst: 2, dailyBudget: 500,  probeBudgetPerDay: 0 },
  { host: 'yc-oss.github.io',         maxConcurrency: 1, minIntervalMs: 2000, burst: 1, dailyBudget: 50,    probeBudgetPerDay: 0 },
  { host: 'remotive.com',             maxConcurrency: 1, minIntervalMs: 2000, burst: 1, dailyBudget: 2000,  probeBudgetPerDay: 0 },
  { host: 'remoteok.com',             maxConcurrency: 1, minIntervalMs: 2000, burst: 1, dailyBudget: 2000,  probeBudgetPerDay: 0 },
  { host: 'himalayas.app',            maxConcurrency: 1, minIntervalMs: 2000, burst: 1, dailyBudget: 2000,  probeBudgetPerDay: 0 },
  { host: 'weworkremotely.com',       maxConcurrency: 1, minIntervalMs: 2000, burst: 1, dailyBudget: 2000,  probeBudgetPerDay: 0 },
  { host: 'www.arbeitnow.com',        maxConcurrency: 1, minIntervalMs: 2000, burst: 1, dailyBudget: 2000,  probeBudgetPerDay: 0 },
  { host: '*',                        maxConcurrency: 1, minIntervalMs: 3000, burst: 1, dailyBudget: 1000,  probeBudgetPerDay: 50, notes: 'Default for any unlisted host' },
  { host: '*.html',                   maxConcurrency: 1, minIntervalMs: 60000, burst: 1, dailyBudget: 200, probeBudgetPerDay: 20, notes: 'Applied to any HTML (non-API) fetch' },
]
