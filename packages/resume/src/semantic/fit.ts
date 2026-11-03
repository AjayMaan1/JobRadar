import { cosine } from '@jobradar/llm'
import type { StoredVector } from './embedding.service.js'

export const FIT_VERSION = 'fit-v1'

/**
 * Cosine → 0..100 calibration. nomic-embed-text: unrelated texts ≈ 0.35–0.5, related ≈ 0.65–0.85.
 * Tunable via FIT_COS_MIN / FIT_COS_MAX once you have your own applications to compare against.
 */
export const FIT_CALIBRATION = {
  cosMin: parseFloat(process.env.FIT_COS_MIN ?? '0.40'),
  cosMax: parseFloat(process.env.FIT_COS_MAX ?? '0.82'),
  /** Minimum similarity for a resume bullet to count as semantic evidence of a requirement. */
  evidenceTau: parseFloat(process.env.FIT_EVIDENCE_TAU ?? '0.72'),
}

export function calibrate(cos: number): number {
  const { cosMin, cosMax } = FIT_CALIBRATION
  return Math.round(Math.max(0, Math.min(1, (cos - cosMin) / (cosMax - cosMin))) * 100)
}

export interface FitResult {
  fitScore: number
  topMatches: Array<{ chunkKey: string; text: string; similarity: number }>
}

/** Profile ↔ job: 0.7 × best chunk + 0.3 × mean of the top 3 chunks. */
export function semanticFit(profile: Float32Array, job: StoredVector[]): FitResult | null {
  if (!job.length) return null
  const sims = job.map((j) => ({ chunkKey: j.chunkKey, text: j.text, similarity: cosine(profile, j.vector) })).sort((a, b) => b.similarity - a.similarity)
  const top = sims.slice(0, 3)
  const mean = top.reduce((a, s) => a + s.similarity, 0) / top.length
  const blended = 0.7 * sims[0].similarity + 0.3 * mean
  return { fitScore: calibrate(blended), topMatches: top.map((t) => ({ ...t, similarity: Math.round(t.similarity * 1000) / 1000 })) }
}

export interface SemanticEvidence {
  skill: string
  chunkKey: string
  text: string
  similarity: number
}

/** For each requirement vector, the nearest resume chunk above τ — "not named, but covered by …". */
export function semanticEvidence(requirements: StoredVector[], resume: StoredVector[], tau = FIT_CALIBRATION.evidenceTau): SemanticEvidence[] {
  const out: SemanticEvidence[] = []
  for (const r of requirements) {
    let best: { chunk: StoredVector; s: number } | null = null
    for (const c of resume) {
      if (c.chunkKey.startsWith('skills/')) continue // the skills list is keyword territory; evidence must be experiential
      const s = cosine(r.vector, c.vector)
      if (!best || s > best.s) best = { chunk: c, s }
    }
    if (best && best.s >= tau) out.push({ skill: r.chunkKey.replace(/^req:/, ''), chunkKey: best.chunk.chunkKey, text: best.chunk.text, similarity: Math.round(best.s * 1000) / 1000 })
  }
  return out
}
