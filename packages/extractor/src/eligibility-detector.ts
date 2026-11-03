export type EligibilityType =
  | 'india_allowed'
  | 'worldwide'
  | 'emea'
  | 'apac'
  | 'country_restricted'
  | 'unknown'

export interface EligibilityResult {
  eligibility: EligibilityType
  confidence: number
  evidence: string[]
}

const INDIA_POSITIVE = [
  /\bindia\b/i,
  /\bindian candidates?\b/i,
  /\bwork from india\b/i,
]

const WORLDWIDE_POSITIVE = [
  /\bworldwide\b/i,
  /\bwork from anywhere\b/i,
  /\banywhere\b/i,
  /\banywhere in the world\b/i,
  /\bglobal remote\b/i,
  /\bglobally distributed\b/i,
  /\bfully remote[^;,.]*(worldwide|global|any country)/i,
  /\bopen to all countries\b/i,
  /\binternational candidates?\b/i,
  /\ball timezones?\b/i,
]

const APAC_POSITIVE = [
  /\bapac\b/i,
  /\basia[- ]pacific\b/i,
  /\basia\b/i,
  /\bsoutheast asia\b/i,
]

const EMEA_POSITIVE = [
  /\bemea\b/i,
  /\beurope[,\s]/i,
  /\beuropean (union|candidates?)\b/i,
  /\bemea time(zone)?\b/i,
]

const COUNTRY_RESTRICTED = [
  /\b(us|u\.s\.|united states)[ -]?(only|based|residents?|citizens?|authorized)\b/i,
  /\bmust be (based in|located in|a resident of)\b/i,
  /\bright to work in (the uk|united kingdom|us|eu|europe|germany|france)\b/i,
  /\b(uk|eu|germany|france|netherlands|canada)[ -]only\b/i,
  /\bwork authorization (in|for) (us|uk|eu|europe)\b/i,
  /\beligible to work in\b/i,
  /\bno[t]? (available|open) (to|for) (india|asia|apac)\b/i,
]

function findMatches(text: string, patterns: RegExp[]): string[] {
  const evidence: string[] = []
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) evidence.push(match[0])
  }
  return evidence
}

export function detectEligibility(
  description: string,
  location: string | undefined | null
): EligibilityResult {
  const text = `${description} ${location ?? ''}`.toLowerCase()

  const restrictedEvidence = findMatches(text, COUNTRY_RESTRICTED)
  if (restrictedEvidence.length > 0) {
    return {
      eligibility: 'country_restricted',
      confidence: 0.85,
      evidence: restrictedEvidence,
    }
  }

  const indiaEvidence = findMatches(text, INDIA_POSITIVE)
  if (indiaEvidence.length > 0) {
    return {
      eligibility: 'india_allowed',
      confidence: 0.95,
      evidence: indiaEvidence,
    }
  }

  const worldwideEvidence = findMatches(text, WORLDWIDE_POSITIVE)
  if (worldwideEvidence.length > 0) {
    return {
      eligibility: 'worldwide',
      confidence: 0.9,
      evidence: worldwideEvidence,
    }
  }

  const apacEvidence = findMatches(text, APAC_POSITIVE)
  if (apacEvidence.length > 0) {
    return {
      eligibility: 'apac',
      confidence: 0.8,
      evidence: apacEvidence,
    }
  }

  const emeaEvidence = findMatches(text, EMEA_POSITIVE)
  if (emeaEvidence.length > 0) {
    return {
      eligibility: 'emea',
      confidence: 0.75,
      evidence: emeaEvidence,
    }
  }

  return {
    eligibility: 'unknown',
    confidence: 0.3,
    evidence: [],
  }
}
