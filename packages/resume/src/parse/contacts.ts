import { EMAIL_RE, PHONE_RE } from './parseability.js'

/** Deterministic contact extraction (shared by the LLM structurer, the heuristic parser and the skeleton). */
export function extractContacts(text: string): { email?: string; phone?: string; urls: string[] } {
  const email = text.match(EMAIL_RE)?.[0]
  const phone = text.match(PHONE_RE)?.[0]?.trim()
  const urls = [...new Set((text.match(/\b(?:https?:\/\/|www\.)[^\s<>"')\]|]+|(?:linkedin\.com|github\.com)\/[^\s<>"')\]|]+/gi) ?? []).map((u) => u.replace(/[.,;]+$/, '')))]
  return { email, phone, urls }
}
