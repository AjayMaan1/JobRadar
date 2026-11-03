import { createHash } from 'node:crypto'
import type { LlmProvider } from '@jobradar/llm'
import { analyzeJdDeterministic } from './deterministic.js'
import { refineJdWithLlm } from './llm.js'
import type { JobRequirementsData } from './types.js'
import { log } from '@jobradar/log'

export * from './types.js'
export { analyzeJdDeterministic, sectionize, normalizeTitle, extractYearsMin, detectSeniority } from './deterministic.js'
export { refineJdWithLlm } from './llm.js'

export function descriptionHash(title: string, description: string): string {
  return createHash('sha256').update(`${title.trim()}\n${description.trim()}`).digest('hex')
}

export async function analyzeJd(title: string, description: string, llm: LlmProvider | null, userId?: string | null): Promise<JobRequirementsData> {
  const base = analyzeJdDeterministic(title, description)
  if (!llm) return base
  try {
    return await refineJdWithLlm(base, title, description, llm, userId)
  } catch (err) {
    log.warn('[jd] LLM refinement failed, using deterministic result:', (err as Error).message)
    return base
  }
}
