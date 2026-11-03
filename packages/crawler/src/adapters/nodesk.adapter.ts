import { chromium } from 'playwright'
import { BaseAdapter } from './base.adapter.js'
import type { RawJob, SourceConfig } from '../types.js'

export class NoDeskAdapter extends BaseAdapter {
  readonly sourceName = 'NoDesk'

  async fetch(config: SourceConfig): Promise<RawJob[]> {
    const browser = await chromium.launch({ headless: true })
    const jobs: RawJob[] = []

    try {
      const page = await browser.newPage()
      page.setDefaultTimeout(20000)
      await page.goto(config.careersUrl!, { waitUntil: 'domcontentloaded', timeout: 30000 })

      const listings = await page.$$eval('a[href*="/remote-jobs/"]', (anchors) =>
        anchors.map((a) => ({
          href: (a as any).href,
          text: (a as any).textContent?.trim() ?? '',
        }))
      )

      for (const link of listings.slice(0, 60)) {
        if (!link.href || !link.text) continue

        const slug = link.href.split('/').filter(Boolean).pop() ?? ''
        jobs.push({
          title: link.text,
          company: 'Unknown',
          applyUrl: link.href,
          sourceUrl: link.href,
          description: '',
          location: 'Worldwide',
          tags: [],
          sourceFingerprint: `nodesk-${slug}`,
          sourceName: this.sourceName,
        })
      }
    } finally {
      await browser.close()
    }

    return this.filterRelevantJobs(jobs)
  }
}
