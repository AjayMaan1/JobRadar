import type { PrismaClient } from '@jobradar/db'
import { fromUSD, metroDef, toUSD } from '@jobradar/extractor'
import { log } from '@jobradar/log'
import type { EvalService } from './eval.service.js'

/**
 * Deployment-level crawl policy derived from the UNION of active users' preferences (HLD §8). The crawler
 * never follows one user; it follows what any user might want, and the admin sees the suggestions.
 *
 *   - excludedHqCountries: countries every active user excludes (a company there is dormant for everyone)
 *   - metros / countries: union of homes → Workday search scopes and anchor suggestions
 *   - floorUsd: the LOWEST user pay floor (USD) — companies confidently below it are demoted for everyone
 */
export interface CrawlScope {
  users: number
  excludedHqCountries: string[]
  countries: string[]
  metros: string[]
  floorUsd: number | null
  computedAt: string
}

export interface CrawlScopeSuggestion {
  kind: 'workday_scope' | 'anchor_metro'
  metro: string
  label: string
  /** Boards that could be scoped to this metro but are not. */
  boardIds: string[]
  message: string
}

export class CrawlScopeService {
  private cache: { at: number; scope: CrawlScope } | null = null
  constructor(private prisma: PrismaClient, private evals: EvalService) {}

  async scope(force = false): Promise<CrawlScope> {
    if (!force && this.cache && Date.now() - this.cache.at < 5 * 60_000) return this.cache.scope
    const users = await this.evals.activeUsers(force)
    const countries = new Set<string>()
    const metros = new Set<string>()
    let excluded: string[] | null = null
    let floorUsd: number | null = null
    let anyNoFloor = false
    for (const u of users) {
      countries.add(u.prefs.home.country)
      for (const m of u.prefs.home.metros) metros.add(m)
      const ex = u.prefs.companies.excludeHqCountries
      excluded = excluded === null ? [...ex] : excluded.filter((c) => ex.includes(c))
      if (u.prefs.pay.floor === null) anyNoFloor = true
      else {
        const usd = toUSD(u.prefs.pay.floor, u.prefs.pay.currency)
        if (usd > 0) floorUsd = floorUsd === null ? usd : Math.min(floorUsd, usd)
      }
    }
    const scope: CrawlScope = { users: users.length, excludedHqCountries: excluded ?? [], countries: [...countries], metros: [...metros], floorUsd: anyNoFloor ? null : floorUsd, computedAt: new Date().toISOString() }
    this.cache = { at: Date.now(), scope }
    return scope
  }

  /** Pay floor in a given currency for display/tiering (null = no demotion). */
  async floorIn(currency: string): Promise<number | null> {
    const s = await this.scope()
    return s.floorUsd === null ? null : fromUSD(s.floorUsd, currency)
  }

  /** Workday boards whose search scope does not cover a metro users care about. */
  async suggestions(): Promise<CrawlScopeSuggestion[]> {
    const s = await this.scope()
    if (!s.metros.length) return []
    const boards = await this.prisma.companyBoard.findMany({ where: { atsType: 'workday', enabled: true }, select: { id: true, queryScope: true, company: { select: { name: true } } } })
    const out: CrawlScopeSuggestion[] = []
    for (const metro of s.metros) {
      const def = metroDef(metro)
      if (!def) continue
      const missing = boards.filter((b) => { const q = (b.queryScope as { searchText?: string } | null)?.searchText?.toLowerCase() ?? ''; return !def.aliases.some((a) => q.includes(a)) })
      if (missing.length) out.push({ kind: 'workday_scope', metro, label: def.label, boardIds: missing.map((b) => b.id), message: `${missing.length} Workday board(s) are not scoped to ${def.label}, which ${s.users === 1 ? 'you' : 'a user'} want(s) for hybrid roles.` })
    }
    return out
  }

  /**
   * Apply a suggestion: add the metro as a second search scope on those boards. Single-user installs apply
   * automatically on preference save (decision 5); multi-user installs do it from the admin Health page.
   */
  async applyMetro(metro: string, boardIds?: string[]): Promise<number> {
    const def = metroDef(metro)
    if (!def) return 0
    const sugg = (await this.suggestions()).find((x) => x.metro === metro)
    const ids = boardIds ?? sugg?.boardIds ?? []
    let n = 0
    for (const id of ids) {
      const b = await this.prisma.companyBoard.findUnique({ where: { id }, select: { queryScope: true } })
      if (!b) continue
      const q = (b.queryScope as { searchText?: string } | null) ?? {}
      const searchText = q.searchText ? `${q.searchText} ${def.label}` : def.label
      await this.prisma.companyBoard.update({ where: { id }, data: { queryScope: { ...q, searchText } as never } })
      n++
    }
    if (n) log.info('crawl scope: metro applied to workday boards', { metro, boards: n })
    this.cache = null
    return n
  }

  async autoApplyIfSingleUser(): Promise<number> {
    const users = await this.prisma.user.count()
    if (users !== 1) return 0
    let n = 0
    for (const sg of await this.suggestions()) n += await this.applyMetro(sg.metro, sg.boardIds)
    return n
  }
}
