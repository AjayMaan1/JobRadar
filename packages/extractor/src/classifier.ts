/**
 * Opportunity classification (locked decisions):
 *   P1 global remote  — non-IN HQ, remote, no restriction that excludes India
 *   P2 india remote   — non-IN HQ, remote, location explicitly India
 *   P3 ncr hybrid     — non-IN HQ MNC/big-tech, HYBRID ONLY, Delhi NCR
 *   none              — everything else (stored, hidden by default)
 */
export type OpportunityClassValue = 'p1_global_remote' | 'p2_india_remote' | 'p3_ncr_hybrid' | 'none'
export type EmploymentTypeValue = 'full_time' | 'contract' | 'part_time' | 'internship' | 'unknown'

export interface ClassifierCompany {
  hqCountry?: string | null
  tags?: string[]
}

export interface ClassifierInput {
  title: string
  location: string | null | undefined
  description: string
  remoteType: 'remote' | 'hybrid' | 'onsite' | 'unknown'
  isRemoteFlag?: boolean | null
  tags?: string[]
  company?: ClassifierCompany | null
}

export interface ClassifierResult {
  opportunityClass: OpportunityClassValue
  reason: string
}

const NCR_CITIES = (process.env.NCR_CITIES ?? 'gurugram,gurgaon,noida,delhi,new delhi,faridabad,ghaziabad,ncr,delhi ncr,greater noida')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)

const INDIA_LOCATION_RE = /\b(india|bengaluru|bangalore|hyderabad|pune|chennai|mumbai|gurugram|gurgaon|noida|delhi|kolkata|ahmedabad|jaipur|chandigarh|indore|kochi|thiruvananthapuram|trivandrum|coimbatore|ist)\b/i

// Restrictions that exclude an India-based candidate (evaluated on location + first ~3k chars of description)
const RESTRICTION_PATTERNS: RegExp[] = [
  /\b(us|usa|u\.s\.|united states|canada|uk|u\.k\.|united kingdom|eu|e\.u\.|europe|european union|emea|latam|latin america|north america|australia|new zealand|germany|france|netherlands|spain|portugal|poland|ireland|switzerland|brazil|mexico|argentina|philippines|japan|singapore)[ -]?(only|based|residents?|citizens?|timezones? only)\b/i,
  /\bremote\s*[-–(]\s*(us|usa|united states|canada|uk|united kingdom|eu|europe|emea|latam|north america|americas|australia|nz|germany|france|netherlands|spain|poland|ireland|brazil|mexico)\b/i,
  /\b(must|need to|required to|should) (be )?(based|located|reside|living|live) (in|within) (the )?(us|usa|united states|canada|uk|united kingdom|eu|europe|emea|latam|north america|australia|germany|france|netherlands|spain|poland|ireland|switzerland|brazil|mexico)\b/i,
  /\b(right|eligible|authori[sz]ed|authori[sz]ation|legally able|permit|eligibility) to work in (the )?(us|usa|united states|canada|uk|united kingdom|eu|europe|germany|france|netherlands|spain|poland|ireland|switzerland|australia)\b/i,
  /\b(us|u\.s\.) work authorization\b/i,
  /\bno (visa )?sponsorship\b.*\b(us|uk|eu|canada)\b/i,
  /\b(within|in) (the )?(us|eu|uk|canadian|pacific|eastern|central|mountain|cet|cest|gmt|bst|pst|est|pt|et) (time ?zones?|hours)\s*(only|required)\b/i,
  /\bcandidates? (must|should) be (in|from) (the )?(us|usa|united states|canada|uk|eu|europe|emea|latam)\b/i,
  /\b(we (are )?(only|currently) (able to )?hir(e|ing)|open to candidates) (in|from) (the )?(us|usa|united states|canada|uk|eu|europe|emea|latam|north america|australia)\b/i,
]

// Explicit signals that an India-based candidate is fine
const INDIA_OK_PATTERNS: RegExp[] = [
  /\bworldwide\b/i,
  /\bwork from anywhere\b/i,
  /\banywhere in the world\b/i,
  /\banywhere\b/i,
  /\bglobal(ly)? remote\b/i,
  /\bglobally distributed\b/i,
  /\bfully remote\b/i,
  /\bremote[- ]first\b/i,
  /\bopen to all countries\b/i,
  /\binternational candidates?\b/i,
  /\ball time ?zones?\b/i,
  /\bany time ?zone\b/i,
  /\bapac\b/i,
  /\basia[- ]pacific\b/i,
  /\bindia\b/i,
  /\bist\b/i,
  /\butc\s*[+]\s*(3|4|5|5:30|6|7|8)\b/i,
  /\bgmt\s*[+]\s*(3|4|5|5:30|6|7|8)\b/i,
  /\boverlap\b.{0,40}\b(ist|cet|cest|gmt|utc|uk|europe|apac|asia|india)\b/i,
  /\b(hire|hiring|employ)\w*\s+(via|through|with)\s+(deel|remote\.com|oyster|papaya|rippling|velocity global|multiplier|an? (eor|employer of record))\b/i,
  /\b(contractor|contract)\b.{0,60}\b(any|all) (country|countries|location)s?\b/i,
  /\bindependent contractor\b/i,
]

export function isNcrLocation(location: string | null | undefined): boolean {
  if (!location) return false
  const loc = location.toLowerCase()
  return NCR_CITIES.some((c) => new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(loc))
}

export function findRestriction(text: string): string | null {
  for (const re of RESTRICTION_PATTERNS) {
    const m = text.match(re)
    if (m) return m[0]
  }
  return null
}

export function findIndiaOk(text: string): string | null {
  for (const re of INDIA_OK_PATTERNS) {
    const m = text.match(re)
    if (m) return m[0]
  }
  return null
}

export function classifyOpportunity(input: ClassifierInput): ClassifierResult {
  const hq = (input.company?.hqCountry ?? '').toUpperCase()
  if (hq === 'IN') return { opportunityClass: 'none', reason: 'india_hq' }

  const location = (input.location ?? '').trim()
  const locLower = location.toLowerCase()
  const desc = (input.description ?? '').slice(0, 4000)
  const text = `${location}\n${desc}`
  const tags = (input.tags ?? []).join(' ').toLowerCase()

  const remoteFlag = input.isRemoteFlag === true
  const locSaysRemote = /\bremote\b/i.test(locLower) || /\bremote\b/.test(tags)
  const isRemote = input.remoteType === 'remote' || remoteFlag || locSaysRemote
  const isHybrid = input.remoteType === 'hybrid' || /\bhybrid\b/i.test(locLower) || /\bhybrid\b/.test(tags)

  if (isRemote && !isHybrid) {
    // P2: location names India explicitly
    if (INDIA_LOCATION_RE.test(location)) {
      return { opportunityClass: 'p2_india_remote', reason: `location: ${location.slice(0, 80)}` }
    }
    const restriction = findRestriction(text)
    const ok = findIndiaOk(text)
    if (restriction && !ok) return { opportunityClass: 'none', reason: `restricted: ${restriction}` }
    if (restriction && ok) {
      // Both present — trust the location line over the description body
      const locRestriction = findRestriction(location)
      if (locRestriction) return { opportunityClass: 'none', reason: `restricted (location): ${locRestriction}` }
      return { opportunityClass: 'p1_global_remote', reason: `india-ok: ${ok} (despite: ${restriction})` }
    }
    if (ok) return { opportunityClass: 'p1_global_remote', reason: `india-ok: ${ok}` }
    // Remote with no restriction phrase at all — accepted as P1 with a weaker reason
    return { opportunityClass: 'p1_global_remote', reason: 'remote, no restriction phrase found' }
  }

  // P3: hybrid only, NCR, MNC/big-tech
  if (isHybrid && isNcrLocation(location)) {
    const tagsArr = (input.company?.tags ?? []).map((t) => t.toLowerCase())
    if (tagsArr.includes('mnc') || tagsArr.includes('big_tech') || tagsArr.includes('anchor')) {
      return { opportunityClass: 'p3_ncr_hybrid', reason: `hybrid in NCR: ${location.slice(0, 80)}` }
    }
    return { opportunityClass: 'none', reason: 'hybrid NCR but company not tagged mnc/big_tech' }
  }

  if (isHybrid) return { opportunityClass: 'none', reason: `hybrid outside NCR: ${location.slice(0, 80) || 'unknown'}` }
  if (input.remoteType === 'onsite') return { opportunityClass: 'none', reason: 'onsite' }
  return { opportunityClass: 'none', reason: `not remote: ${location.slice(0, 80) || 'unknown location'}` }
}

export function detectEmploymentType(title: string, description: string, hints: Array<string | null | undefined> = []): EmploymentTypeValue {
  const h = hints.filter(Boolean).join(' ').toLowerCase()
  const t = title.toLowerCase()
  const d = (description ?? '').slice(0, 2000).toLowerCase()
  if (/\bintern(ship)?\b/.test(t) || /\bintern(ship)?\b/.test(h)) return 'internship'
  if (/\bpart[- ]time\b/.test(h) || /\bpart[- ]time\b/.test(t)) return 'part_time'
  if (/\b(contract|contractor|freelance|b2b|c2c|1099)\b/.test(h) || /\b(contract|contractor|freelance)\b/.test(t)) return 'contract'
  if (/\b(full[- ]?time|permanent|fte)\b/.test(h) || /\bfull[- ]?time\b/.test(t)) return 'full_time'
  if (/\b(independent contractor|contract role|contract position|b2b contract|freelance)\b/.test(d)) return 'contract'
  if (/\bfull[- ]?time\b/.test(d)) return 'full_time'
  return 'unknown'
}
