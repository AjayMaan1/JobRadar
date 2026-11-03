import { chromium } from 'playwright'
import { BaseAdapter } from './base.adapter.js'
import type { RawJob, SourceConfig } from '../types.js'

export class BaytAdapter extends BaseAdapter {
  readonly sourceName = 'Bayt UAE'

  async fetch(config: SourceConfig): Promise<RawJob[]> {
    const browser = await chromium.launch({ headless: true })
    const jobs: RawJob[] = []

    try {
      const page = await browser.newPage()
      await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' })
      await page.goto(config.careersUrl!, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForSelector('[data-js-aid="JobListingCard"]', { timeout: 10000 }).catch(() => {})

      const listings = await page.$$eval('[data-js-aid="JobListingCard"]', (cards) =>
        cards.map((card) => {
          const titleEl = card.querySelector('[class*="title"]') ?? card.querySelector('h2, h3')
          const companyEl = card.querySelector('[class*="company"]') ?? card.querySelector('[class*="employer"]')
          const linkEl = card.querySelector('a[href*="/jobs/"]') ?? card.querySelector('a')
          const dateEl = card.querySelector('time') ?? card.querySelector('[class*="date"]')
          const salaryEl = card.querySelector('[class*="salary"]')

          return {
            title: titleEl?.textContent?.trim() ?? '',
            company: companyEl?.textContent?.trim() ?? '',
            href: (linkEl as any)?.href ?? '',
            date: (dateEl as any)?.dateTime ?? dateEl?.textContent?.trim() ?? '',
            salary: salaryEl?.textContent?.trim() ?? '',
          }
        })
      )

      for (const item of listings) {
        if (!item.title || !item.href) continue
        const slug = item.href.split('/').filter(Boolean).pop() ?? ''

        jobs.push({
          title: item.title,
          company: item.company || 'Unknown',
          applyUrl: item.href.startsWith('http') ? item.href : `https://www.bayt.com${item.href}`,
          sourceUrl: item.href.startsWith('http') ? item.href : `https://www.bayt.com${item.href}`,
          description: item.salary ? `Salary: ${item.salary}` : '',
          postedAt: item.date || undefined,
          salary: item.salary || undefined,
          location: 'UAE',
          tags: [],
          sourceFingerprint: `bayt-${slug}`,
          sourceName: this.sourceName,
        })
      }
    } finally {
      await browser.close()
    }

    return jobs
  }
}
