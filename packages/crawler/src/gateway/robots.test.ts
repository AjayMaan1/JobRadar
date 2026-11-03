import { describe, expect, it } from 'vitest'
import { parseRobots } from './robots.js'

describe('parseRobots', () => {
  it('picks the JobRadar group over * and parses allow/disallow/crawl-delay', () => {
    const r = parseRobots(`User-agent: *\nDisallow: /\n\nUser-agent: JobRadar\nDisallow: /private\nAllow: /private/ok\nCrawl-delay: 2\n`)
    expect(r.disallow).toEqual(['/private'])
    expect(r.allow).toEqual(['/private/ok'])
    expect(r.crawlDelayMs).toBe(2000)
  })
  it('falls back to * and tolerates comments/blank lines', () => {
    const r = parseRobots(`# hi\nUser-agent: googlebot\nDisallow: /g\n\nUser-agent: *\nDisallow: /x # comment\n`)
    expect(r.disallow).toEqual(['/x'])
  })
  it('empty file → allow everything', () => {
    expect(parseRobots('')).toEqual({ disallow: [], allow: [], crawlDelayMs: null })
  })
})
