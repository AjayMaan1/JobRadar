import type Redis from 'ioredis'
import { CRAWLER_CONFIG } from '../config.js'

interface RobotsRules {
  disallow: string[]
  allow: string[]
  crawlDelayMs: number | null
}

/** Minimal robots.txt evaluator (User-agent: * and our own UA token), cached in Redis. */
export class RobotsCache {
  constructor(private redis: Redis) {}

  async isAllowed(url: string, fetchImpl: (u: string) => Promise<string | null>): Promise<{ allowed: boolean; crawlDelayMs: number | null }> {
    const u = new URL(url)
    const rules = await this.rulesFor(u.origin, fetchImpl)
    if (!rules) return { allowed: true, crawlDelayMs: null }
    const path = u.pathname + u.search
    const matchLen = (list: string[]) =>
      list.reduce((best, rule) => (rule && path.startsWith(rule) && rule.length > best ? rule.length : best), 0)
    const allowLen = matchLen(rules.allow)
    const disallowLen = matchLen(rules.disallow)
    return { allowed: allowLen >= disallowLen, crawlDelayMs: rules.crawlDelayMs }
  }

  private async rulesFor(origin: string, fetchImpl: (u: string) => Promise<string | null>): Promise<RobotsRules | null> {
    const key = `gw:robots:${origin}`
    const cached = await this.redis.get(key)
    if (cached) return cached === 'none' ? null : (JSON.parse(cached) as RobotsRules)

    let text: string | null = null
    try {
      text = await fetchImpl(`${origin}/robots.txt`)
    } catch {
      text = null
    }
    const rules = text ? parseRobots(text) : null
    await this.redis.setex(key, CRAWLER_CONFIG.robotsTtlSeconds, rules ? JSON.stringify(rules) : 'none')
    return rules
  }
}

export function parseRobots(text: string): RobotsRules {
  const groups: Array<{ agents: string[]; disallow: string[]; allow: string[]; crawlDelay: number | null }> = []
  let current: (typeof groups)[number] | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) continue
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const field = line.slice(0, idx).trim().toLowerCase()
    const value = line.slice(idx + 1).trim()
    if (field === 'user-agent') {
      if (!current || current.disallow.length || current.allow.length || current.crawlDelay !== null) {
        current = { agents: [], disallow: [], allow: [], crawlDelay: null }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
    } else if (current) {
      if (field === 'disallow') current.disallow.push(value)
      else if (field === 'allow') current.allow.push(value)
      else if (field === 'crawl-delay') {
        const n = parseFloat(value)
        if (!isNaN(n)) current.crawlDelay = n * 1000
      }
    }
  }
  const own = groups.find((g) => g.agents.some((a) => a.includes('jobradar')))
  const star = groups.find((g) => g.agents.includes('*'))
  const g = own ?? star
  if (!g) return { disallow: [], allow: [], crawlDelayMs: null }
  return { disallow: g.disallow.filter(Boolean), allow: g.allow.filter(Boolean), crawlDelayMs: g.crawlDelay }
}
