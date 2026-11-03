import { BaseAdapter } from './base.adapter.js'
import type { RawJob, SourceConfig } from '../types.js'
import { log } from '@jobradar/log'

interface LeverPosting {
  id: string
  text: string
  categories: { team?: string; location?: string; department?: string }
  description: string
  descriptionPlain: string
  hostedUrl: string
  applyUrl: string
  createdAt: number
}

const LEVER_COMPANIES = [
  'stripe', 'notion', 'figma', 'linear', 'vercel', 'planetscale',
  'shopify', 'intercom', 'segment', 'mixpanel', 'postman', 'algolia',
  'contentful', 'sanity', 'prismic', 'webflow', 'retool', 'airtable',
]

export class LeverAdapter extends BaseAdapter {
  readonly sourceName = 'Lever ATS'

  async fetch(config: SourceConfig): Promise<RawJob[]> {
    const jobs: RawJob[] = []

    for (const slug of LEVER_COMPANIES) {
      try {
        const res = await this.fetchWithRetry(
          `https://api.lever.co/v0/postings/${slug}?mode=json`,
          {},
          2
        )
        const postings = await res.json() as LeverPosting[]
        if (!Array.isArray(postings)) continue

        for (const p of postings) {
          const loc = (p.categories?.location ?? '').toLowerCase()
          const isRemote =
            loc.includes('remote') || loc.includes('anywhere') || loc === ''

          if (!isRemote) continue

          jobs.push({
            title: p.text,
            company: slug.charAt(0).toUpperCase() + slug.slice(1),
            applyUrl: p.applyUrl ?? p.hostedUrl,
            sourceUrl: p.hostedUrl,
            description: p.descriptionPlain ?? p.description?.replace(/<[^>]+>/g, ' ') ?? '',
            postedAt: p.createdAt ? new Date(p.createdAt).toISOString() : undefined,
            location: p.categories?.location,
            tags: [p.categories?.team, p.categories?.department].filter(Boolean) as string[],
            sourceFingerprint: `lever-${p.id}`,
            sourceName: this.sourceName,
          })
        }

        await new Promise((r) => setTimeout(r, 400))
      } catch (err) {
        log.warn(`Lever: failed ${slug}:`, err)
      }
    }

    return this.filterRelevantJobs(jobs)
  }
}
