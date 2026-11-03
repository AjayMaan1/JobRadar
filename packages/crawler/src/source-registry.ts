/**
 * Single source of truth for "which adapter handles which aggregator Source row".
 * Used by CrawlerService (worker) and /api/sources (web) — no more duplicated domain lists.
 */
import { BaseAdapter } from './adapters/base.adapter.js'
import { RemotiveAdapter } from './adapters/remotive.adapter.js'
import { ArbeitnowAdapter } from './adapters/arbeitnow.adapter.js'
import { HimalayasAdapter } from './adapters/himalayas.adapter.js'
import { RemoteOKAdapter } from './adapters/remoteok.adapter.js'
import { WeWorkRemotelyAdapter } from './adapters/weworkremotely.adapter.js'
import { EURemoteJobsAdapter } from './adapters/euremotejobs.adapter.js'
import { NoDeskAdapter } from './adapters/nodesk.adapter.js'
import { BaytAdapter } from './adapters/bayt.adapter.js'
import { EverJobsAdapter } from './adapters/everjobs.adapter.js'
import { GenericRSSAdapter } from './adapters/generic-rss.adapter.js'
import { GenericCheerioAdapter } from './adapters/generic-cheerio.adapter.js'
import { WorkingNomadsAdapter } from './adapters/workingnomads.adapter.js'
import { ArcAdapter } from './adapters/arc.adapter.js'
import { YCJobsAdapter } from './adapters/yc-jobs.adapter.js'
import { WellfoundAdapter } from './adapters/wellfound.adapter.js'
import { UplersAdapter } from './adapters/uplers.adapter.js'
import { WorkdayAdapter } from './adapters/workday.adapter.js'
import { SmartRecruitersAdapter } from './adapters/smartrecruiters.adapter.js'
import type { SourceConfig } from './types.js'

export interface SourceLike {
  id: string
  name: string
  domain: string
  ingestionMethod: string
  apiUrl?: string | null
  careersUrl?: string | null
  companyId?: string | null
  atsType?: string | null
  region?: string | null
  country?: string | null
  refreshIntervalHours: number
  qualityScore: number
  enabled?: boolean
}

const adapterMap: Record<string, BaseAdapter> = {
  'ever-jobs.io': new EverJobsAdapter(),

  // API
  'remotive.io': new RemotiveAdapter(),
  'remotive.com': new RemotiveAdapter(),
  'arbeitnow.com': new ArbeitnowAdapter(),
  'himalayas.app': new HimalayasAdapter(),
  'remoteok.io': new RemoteOKAdapter(),
  'workingnomads.com': new WorkingNomadsAdapter(),
  'workatastartup.com': new YCJobsAdapter(),
  'ycombinator.com': new YCJobsAdapter(),

  // Company-specific ATS sources kept for backward compatibility (prefer company_boards)
  'myworkdayjobs.com': new WorkdayAdapter(),
  'careers.smartrecruiters.com': new SmartRecruitersAdapter(),
  'jobs.smartrecruiters.com': new SmartRecruitersAdapter(),
  'platform.uplers.com': new UplersAdapter(),
  'uplers.com': new UplersAdapter(),

  // RSS
  'euremotejobs.com': new EURemoteJobsAdapter(),
  'remotive-rss.io': new GenericRSSAdapter('Remotive (RSS)', 'https://remotive.com/remote-jobs/feed/software-dev', 'Worldwide'),
  'remoteineurope.eu': new GenericRSSAdapter('Remote in Europe', 'https://remoteineurope.eu/feed/', 'EMEA'),
  'himalayas-rss.app': new GenericRSSAdapter('Himalayas RSS', 'https://himalayas.app/jobs/rss', 'Worldwide'),
  'arbeitnow-feed.com': new GenericRSSAdapter('Arbeitnow Europe Feed', 'https://www.arbeitnow.com/feed', 'Europe'),
  'jobicy.com': new GenericRSSAdapter('Jobicy', 'https://jobicy.com/?feed=job_feed&job_types=full-time&search_keywords=engineer', 'Worldwide'),
  'jobspresso.co': new GenericRSSAdapter('Jobspresso', 'https://jobspresso.co/feed/', 'Worldwide'),
  'remotepython.com': new GenericRSSAdapter('Remote Python', 'https://www.remotepython.com/feed/', 'Worldwide'),
  'remoteees.com': new GenericRSSAdapter('Remoteees', 'https://remoteees.com/feed/', 'Worldwide'),
  'remote4me.com': new GenericRSSAdapter('Remote4Me', 'https://remote4me.com/feed/', 'Worldwide'),
  'nohq.co': new GenericRSSAdapter('NoHQ', 'https://nohq.co/jobs/feed/', 'Worldwide'),
  'swissdevjobs.ch': new GenericRSSAdapter('SwissDevJobs', 'https://swissdevjobs.ch/rss', 'Switzerland'),

  // Cheerio
  'weworkremotely.com': new WeWorkRemotelyAdapter(),
  'remote.co': new GenericCheerioAdapter('Remote.co', { container: '.job_listing', title: '.position', company: '.company', link: 'a', date: '.meta-data time' }, 'https://remote.co/remote-jobs/developer/', 'Worldwide'),
  'justremote.co': new GenericCheerioAdapter('JustRemote', { container: '.job-item', title: '.job-item__title', company: '.job-item__company', link: 'a.job-item__link', date: '.job-item__date' }, 'https://justremote.co/remote-developer-jobs', 'Worldwide'),
  'jobgether.com': new GenericCheerioAdapter('Jobgether', { container: '.job-card', title: '.job-card__title', company: '.job-card__company', link: 'a', date: '.job-card__date', salary: '.job-card__salary' }, 'https://jobgether.com/jobs?remote=true&category=tech', 'Global'),
  'dailyremote.com': new GenericCheerioAdapter('DailyRemote', { container: '.job-listing', title: 'h2', company: '.company-name', link: 'a', date: 'time' }, 'https://dailyremote.com/remote-software-developer-jobs', 'Worldwide'),
  'germantechjobs.de': new GenericCheerioAdapter('GermanTechJobs', { container: '.job-list-item', title: '.job-title', company: '.company-name', link: 'a', date: '.date', salary: '.salary' }, 'https://germantechjobs.de/jobs/remote', 'Germany'),
  'eurotechjobs.com': new GenericCheerioAdapter('EuroTechJobs', { container: '.job', title: '.job-title', company: '.job-company', link: 'a.job-link', date: '.job-date' }, 'https://www.eurotechjobs.com/search/search.php?remote=remote', 'Europe'),
  'nextleveljobs.eu': new GenericCheerioAdapter('Next Level Jobs EU', { container: '.job-card', title: '.job-title', company: '.company', link: 'a', salary: '.salary' }, 'https://nextleveljobs.eu/jobs', 'Europe'),
  'devitjobs.uk': new GenericCheerioAdapter('DevITjobs UK', { container: '.job-card', title: 'h3', company: '.company-name', link: 'a', date: 'time', salary: '.salary' }, 'https://devitjobs.uk/jobs/remote', 'UK'),
  'relocate.me': new GenericCheerioAdapter('Relocate.me', { container: '.job-card', title: '.job-title', company: '.company', link: 'a', date: '.date', salary: '.salary' }, 'https://relocate.me/jobs', 'Global'),
  'dynamitejobs.com': new GenericCheerioAdapter('Dynamite Jobs', { container: '.job', title: '.job-title', company: '.company-name', link: 'a', date: 'time' }, 'https://dynamitejobs.com/remote-jobs/software-development', 'Worldwide'),
  '4dayweek.io': new GenericCheerioAdapter('4dayweek.io', { container: '.job-card', title: '.job-title', company: '.company', link: 'a', date: '.posted-date', salary: '.salary' }, 'https://4dayweek.io/remote-jobs/engineering', 'Global'),

  // Playwright
  'nodesk.co': new NoDeskAdapter(),
  'bayt.com': new BaytAdapter(),

  // Payload-in-HTML
  'arc.dev': new ArcAdapter(),
  'arc.dev-uae': new ArcAdapter(),
  'wellfound.com': new WellfoundAdapter(),
}

/** Sources superseded by company_boards (multi-company ATS crawls with hardcoded slugs). */
export const SUPERSEDED_DOMAINS = new Set(['boards.greenhouse.io', 'jobs.lever.co', 'jobs.ashbyhq.com', 'job-boards.greenhouse.io/remotecom', 'findwork.dev'])

export function toSourceConfig(source: SourceLike): SourceConfig {
  return {
    id: source.id,
    name: source.name,
    domain: source.domain,
    ingestionMethod: source.ingestionMethod,
    apiUrl: source.apiUrl,
    careersUrl: source.careersUrl,
    companyId: source.companyId,
    atsType: source.atsType,
    region: source.region,
    country: source.country,
    rateDelayMs: parseInt(process.env.CRAWL_RATE_DELAY_MS ?? '1500'),
    refreshIntervalHours: source.refreshIntervalHours,
    qualityScore: source.qualityScore,
  }
}

export function adapterForSource(source: SourceLike): BaseAdapter | undefined {
  if (SUPERSEDED_DOMAINS.has(source.domain)) return undefined
  let adapter = adapterMap[source.domain]
  if (!adapter) {
    const suffix = Object.keys(adapterMap).find((d) => source.domain.endsWith(d))
    if (suffix) adapter = adapterMap[suffix]
  }
  return adapter
}

export function availabilityIssueForSource(source: SourceLike): string | null {
  if (SUPERSEDED_DOMAINS.has(source.domain)) return 'Superseded by company boards (watchlist). Disable this source.'
  const adapter = adapterForSource(source)
  if (!adapter) return `No adapter for domain: ${source.domain}`
  return adapter.availabilityIssue(toSourceConfig(source))
}
