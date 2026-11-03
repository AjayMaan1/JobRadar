import type { Job, PrismaClient } from '@jobradar/db'
import { apiUrlFor, atsRefFromUrl, engineFor, stripHtml, GreenhouseEngine, type AtsRef, type BoardRef, type FetchGateway } from '@jobradar/crawler'
import type { ApplicationQuestion } from '@jobradar/crawler'
import { log } from '@jobradar/log'

export interface HydrationResult {
  description: string
  source: 'hydrated'
  via: 'ats_api' | 'html'
}

/**
 * On-demand full job description for jobs whose feed gave us none (WWR, NoDesk, generic adapters…)
 * — audit F5 / backlog C5-1. Tries the ATS detail API first (cheap, structured), then the apply page HTML
 * through the gateway (robots + budgets apply). Returns null when nothing usable was found; the caller then
 * asks the user to paste the JD.
 */
export class JdHydrationService {
  constructor(private prisma: PrismaClient, private gateway: FetchGateway) {}

  async hydrate(job: Job): Promise<HydrationResult | null> {
    const urls = [job.applyUrl, job.sourceUrl].filter((u): u is string => Boolean(u))
    for (const url of urls) {
      const ref = atsRefFromUrl(url)
      if (!ref) continue
      const text = await this.viaAts(ref, url, job).catch((err) => { log.warn('[hydrate] ats detail failed', ref.ats, (err as Error).message); return null })
      if (text && text.length >= 200) return { description: text, source: 'hydrated', via: 'ats_api' }
    }
    for (const url of urls) {
      if (!/^https?:\/\//i.test(url)) continue
      const text = await this.viaHtml(url).catch((err) => { log.warn('[hydrate] html failed', (err as Error).message); return null })
      if (text && text.length >= 200) return { description: text, source: 'hydrated', via: 'html' }
    }
    return null
  }

  /** Public application questions (Greenhouse only for now). Cached by the caller on job_requirements. */
  async questions(job: Job): Promise<ApplicationQuestion[] | null> {
    for (const url of [job.applyUrl, job.sourceUrl].filter((u): u is string => Boolean(u))) {
      const ref = atsRefFromUrl(url)
      if (ref?.ats !== 'greenhouse') continue
      const id = externalIdFromUrl('greenhouse', url)
      if (!id) continue
      const engine = engineFor('greenhouse') as GreenhouseEngine | null
      if (!engine?.questions) continue
      try {
        return await engine.questions(await this.boardRef(ref, job.company), { externalId: id }, this.gateway)
      } catch (err) {
        log.warn('[hydrate] questions failed', (err as Error).message)
      }
    }
    return null
  }

  private async boardRef(ref: AtsRef, companyName: string): Promise<BoardRef> {
    const board = await this.prisma.companyBoard.findUnique({ where: { atsType_slug: { atsType: ref.ats, slug: ref.slug } }, select: { id: true, apiUrl: true, careersUrl: true, queryScope: true } })
    return { id: board?.id ?? '', atsType: ref.ats, slug: ref.slug, apiUrl: board?.apiUrl ?? apiUrlFor(ref.ats, ref.slug), careersUrl: board?.careersUrl ?? ref.careersUrl, queryScope: (board?.queryScope as Record<string, unknown> | null) ?? null, companyName }
  }

  private async viaAts(ref: AtsRef, url: string, job: Job): Promise<string | null> {
    const board = await this.boardRef(ref, job.company)
    const id = externalIdFromUrl(ref.ats, url)
    switch (ref.ats) {
      case 'greenhouse':
      case 'workable':
      case 'smartrecruiters': {
        if (!id) return null
        const engine = engineFor(ref.ats)
        if (!engine?.detail) return null
        const d = await engine.detail(board, { externalId: id, title: job.title, url, location: null }, this.gateway)
        return d?.description ?? null
      }
      case 'lever': {
        if (!id) return null
        const { data } = await this.gateway.json<{ descriptionPlain?: string; description?: string; lists?: Array<{ text: string; content: string }>; additionalPlain?: string }>({
          url: `https://api.lever.co/v0/postings/${ref.slug}/${id}`, purpose: 'detail', boardId: board.id || null,
        })
        if (!data) return null
        const lists = (data.lists ?? []).map((l) => `# ${l.text}\n${stripHtml(l.content)}`).join('\n')
        return [data.descriptionPlain ?? stripHtml(data.description), lists, data.additionalPlain].filter(Boolean).join('\n\n')
      }
      case 'ashby': {
        const { data } = await this.gateway.json<{ jobs?: Array<{ id: string; jobUrl?: string; descriptionPlain?: string; descriptionHtml?: string }> }>({ url: board.apiUrl, purpose: 'detail', boardId: board.id || null })
        const jobs = data?.jobs ?? []
        const hit = jobs.find((j) => (id && j.id === id) || (j.jobUrl && url.startsWith(j.jobUrl))) ?? null
        return hit ? hit.descriptionPlain ?? stripHtml(hit.descriptionHtml) : null
      }
      default:
        return null
    }
  }

  private async viaHtml(url: string): Promise<string | null> {
    const res = await this.gateway.fetch({ url, purpose: 'detail', kind: 'html', timeoutMs: 20_000 })
    if (res.outcome !== 'changed' || !res.body) return null
    return extractMainText(res.body)
  }
}

export function externalIdFromUrl(ats: string, url: string): string | null {
  const m =
    ats === 'greenhouse' ? url.match(/\/jobs\/(\d+)/) :
    ats === 'lever' || ats === 'ashby' ? url.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i) :
    ats === 'workable' ? url.match(/\/j\/([A-Z0-9]+)/i) :
    ats === 'smartrecruiters' ? url.match(/\/(\d{9,})/) :
    null
  return m ? m[1] : null
}

/** Best-effort main content of a job page: drop chrome, prefer <main>/<article>/job-description containers. */
export function extractMainText(html: string): string {
  let h = html.replace(/<(script|style|noscript|svg|nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, ' ')
  const pick =
    h.match(/<(?:main|article)[^>]*>([\s\S]*?)<\/(?:main|article)>/i)?.[1] ??
    h.match(/<[^>]+(?:id|class)=["'][^"']*(?:job[-_ ]?(?:description|details|content|posting)|description|posting-content|content-intro|section-wrapper)[^"']*["'][^>]*>([\s\S]*?)(?=<(?:footer|aside)|$)/i)?.[1] ??
    h.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ??
    h
  const text = stripHtml(pick)
  // drop cookie/consent boilerplate lines
  return text.split('\n').filter((l) => !/cookie|accept all|privacy policy|terms of service|sign in|log in|©/i.test(l) || l.length > 140).join('\n').trim()
}
