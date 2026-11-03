import { prisma } from '@jobradar/db'
import { Prisma } from '@jobradar/db'
import { log, withTimeout } from '@jobradar/log'

/**
 * Lexical search candidates (audit NEW-09 / GH-2): Postgres full-text (`search_tsv`, weighted title > company/skills
 * > description) ∪ trigram similarity on title/company, ranked. Replaces the 14-term × 4-column unanchored ILIKE
 * scan. Falls back to null (caller uses ILIKE) when the migration has not been applied yet.
 */
export interface LexicalHit { jobId: string; rank: number }

/** Circuit: after a failure the raw query is skipped for a while (migration missing, DB hiccup), then re-probed. */
let disabledUntil = 0
const DISABLE_MS = 10 * 60_000

export async function lexicalCandidates(original: string, terms: string[], k = 300): Promise<LexicalHit[] | null> {
  if (Date.now() < disabledUntil) return null
  const q = original.trim().slice(0, 200)
  if (!q) return null
  // websearch syntax: quoted phrases, "or", "-". Synonyms are OR-ed in as extra alternatives.
  const alternatives = [q, ...terms.filter((t) => t !== q).slice(0, 12)].map((t) => `"${t.replace(/["\\]/g, ' ')}"`).join(' or ')
  try {
    const rows = await withTimeout(
      prisma.$queryRaw<Array<{ id: string; rank: number }>>(Prisma.sql`
        SELECT j.id, (ts_rank_cd(j.search_tsv, query, 32) + 0.5 * GREATEST(similarity(j.title, ${q}), similarity(j.company, ${q})))::float AS rank
        FROM jobs j, websearch_to_tsquery('english', ${alternatives}) query
        WHERE j.status = 'new' AND (j.search_tsv @@ query OR j.title % ${q} OR j.company % ${q})
        ORDER BY rank DESC
        LIMIT ${k}
      `),
      4000,
      'lexical search',
    )
    return rows.map((r) => ({ jobId: r.id, rank: Number(r.rank) }))
  } catch (err) {
    const msg = (err as Error).message
    disabledUntil = Date.now() + DISABLE_MS
    log.warn('full-text search unavailable — using ILIKE fallback for 10 min (migration v4 applied?)', { reason: msg.slice(0, 160) })
    return null
  }
}

/** Reciprocal rank fusion over any number of ranked id lists. */
export function fuse(lists: string[][], k = 60): string[] {
  const score = new Map<string, number>()
  for (const list of lists) list.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + 1 / (k + i)))
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
}
