import { BaseAdapter } from './base.adapter.js'
import type { RawJob, SourceConfig } from '../types.js'
import { log } from '@jobradar/log'

interface AshbyJob {
  id: string
  title: string
  locationName: string
  isRemote: boolean
  jobUrl: string
  publishedAt: string
  department?: { name: string }
  team?: { name: string }
}

interface AshbyResponse {
  jobs: AshbyJob[]
}

const ASHBY_COMPANIES = [
  'anthropic', 'openai', 'mistral', 'cohere', 'huggingface',
  'replit', 'cursor', 'supabase', 'neon', 'turso',
  'deno', 'bun', 'fly', 'railway', 'render',
  'posthog', 'cal', 'cal-com', 'langchain', 'weaviate',
]

export class AshbyAdapter extends BaseAdapter {
  readonly sourceName = 'Ashby ATS'

  async fetch(_config: SourceConfig): Promise<RawJob[]> {
    const jobs: RawJob[] = []

    for (const slug of ASHBY_COMPANIES) {
      try {
        const res = await this.fetchWithRetry(
          `https://jobs.ashbyhq.com/api/non-user-graphql`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              operationName: 'ApiJobBoardWithTeams',
              variables: { organizationHostedJobsPageName: slug },
              query: `query ApiJobBoardWithTeams($organizationHostedJobsPageName: String!) {
                jobBoard: jobBoardWithTeams(organizationHostedJobsPageName: $organizationHostedJobsPageName) {
                  jobPostings { id title locationName isRemote jobUrl publishedAt department { name } team { name } }
                }
              }`,
            }),
          },
          2
        )
        const data = await res.json() as { data?: { jobBoard?: { jobPostings?: AshbyJob[] } } }
        const postings = data?.data?.jobBoard?.jobPostings ?? []

        for (const p of postings) {
          if (!p.isRemote && !p.locationName?.toLowerCase().includes('remote')) continue

          jobs.push({
            title: p.title,
            company: slug.charAt(0).toUpperCase() + slug.slice(1),
            applyUrl: p.jobUrl,
            sourceUrl: p.jobUrl,
            description: '',
            postedAt: p.publishedAt,
            location: p.locationName || 'Remote',
            tags: [p.department?.name, p.team?.name].filter(Boolean) as string[],
            sourceFingerprint: `ashby-${p.id}`,
            sourceName: this.sourceName,
          })
        }

        await new Promise((r) => setTimeout(r, 400))
      } catch (err) {
        log.warn(`Ashby: failed ${slug}:`, err)
      }
    }

    return this.filterRelevantJobs(jobs)
  }
}
