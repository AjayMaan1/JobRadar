/**
 * Geo dictionary for structured job facts (HLD dynamic preferences §4). Countries (ISO-2 + aliases), regions
 * (token → member countries) and metros (id → country + aliases). Deliberately small and explicit; extend by
 * adding rows, never by special-casing in code.
 */
export interface CountryDef { code: string; aliases: string[]; tz: number /* typical UTC offset, hours */ }

export const COUNTRIES: CountryDef[] = [
  { code: 'IN', aliases: ['india', 'bharat'], tz: 5.5 },
  { code: 'US', aliases: ['united states', 'united states of america', 'usa', 'u.s.', 'u.s.a.', 'us', 'america'], tz: -6 },
  { code: 'CA', aliases: ['canada', 'canadian'], tz: -5 },
  { code: 'MX', aliases: ['mexico'], tz: -6 },
  { code: 'BR', aliases: ['brazil', 'brasil'], tz: -3 },
  { code: 'AR', aliases: ['argentina'], tz: -3 },
  { code: 'CO', aliases: ['colombia'], tz: -5 },
  { code: 'CL', aliases: ['chile'], tz: -4 },
  { code: 'GB', aliases: ['united kingdom', 'uk', 'u.k.', 'great britain', 'england', 'scotland', 'wales', 'britain'], tz: 0 },
  { code: 'IE', aliases: ['ireland'], tz: 0 },
  { code: 'DE', aliases: ['germany', 'deutschland'], tz: 1 },
  { code: 'FR', aliases: ['france'], tz: 1 },
  { code: 'NL', aliases: ['netherlands', 'the netherlands', 'holland'], tz: 1 },
  { code: 'BE', aliases: ['belgium'], tz: 1 },
  { code: 'ES', aliases: ['spain'], tz: 1 },
  { code: 'PT', aliases: ['portugal'], tz: 0 },
  { code: 'IT', aliases: ['italy'], tz: 1 },
  { code: 'CH', aliases: ['switzerland'], tz: 1 },
  { code: 'AT', aliases: ['austria'], tz: 1 },
  { code: 'PL', aliases: ['poland'], tz: 1 },
  { code: 'CZ', aliases: ['czech republic', 'czechia'], tz: 1 },
  { code: 'RO', aliases: ['romania'], tz: 2 },
  { code: 'HU', aliases: ['hungary'], tz: 1 },
  { code: 'UA', aliases: ['ukraine'], tz: 2 },
  { code: 'SE', aliases: ['sweden'], tz: 1 },
  { code: 'NO', aliases: ['norway'], tz: 1 },
  { code: 'DK', aliases: ['denmark'], tz: 1 },
  { code: 'FI', aliases: ['finland'], tz: 2 },
  { code: 'EE', aliases: ['estonia'], tz: 2 },
  { code: 'LT', aliases: ['lithuania'], tz: 2 },
  { code: 'LV', aliases: ['latvia'], tz: 2 },
  { code: 'GR', aliases: ['greece'], tz: 2 },
  { code: 'TR', aliases: ['turkey', 'türkiye'], tz: 3 },
  { code: 'IL', aliases: ['israel'], tz: 2 },
  { code: 'AE', aliases: ['united arab emirates', 'uae', 'u.a.e.'], tz: 4 },
  { code: 'SA', aliases: ['saudi arabia', 'ksa'], tz: 3 },
  { code: 'EG', aliases: ['egypt'], tz: 2 },
  { code: 'NG', aliases: ['nigeria'], tz: 1 },
  { code: 'KE', aliases: ['kenya'], tz: 3 },
  { code: 'ZA', aliases: ['south africa'], tz: 2 },
  { code: 'PK', aliases: ['pakistan'], tz: 5 },
  { code: 'BD', aliases: ['bangladesh'], tz: 6 },
  { code: 'LK', aliases: ['sri lanka'], tz: 5.5 },
  { code: 'NP', aliases: ['nepal'], tz: 5.75 },
  { code: 'SG', aliases: ['singapore'], tz: 8 },
  { code: 'MY', aliases: ['malaysia'], tz: 8 },
  { code: 'ID', aliases: ['indonesia'], tz: 7 },
  { code: 'TH', aliases: ['thailand'], tz: 7 },
  { code: 'VN', aliases: ['vietnam', 'viet nam'], tz: 7 },
  { code: 'PH', aliases: ['philippines'], tz: 8 },
  { code: 'HK', aliases: ['hong kong'], tz: 8 },
  { code: 'TW', aliases: ['taiwan'], tz: 8 },
  { code: 'CN', aliases: ['china', 'prc'], tz: 8 },
  { code: 'JP', aliases: ['japan'], tz: 9 },
  { code: 'KR', aliases: ['south korea', 'korea'], tz: 9 },
  { code: 'AU', aliases: ['australia'], tz: 10 },
  { code: 'NZ', aliases: ['new zealand', 'nz'], tz: 12 },
]

/** Region tokens → member countries. WORLDWIDE is special-cased (everyone). */
export const REGIONS: Record<string, string[]> = {
  WORLDWIDE: [],
  EU: ['DE', 'FR', 'NL', 'BE', 'ES', 'PT', 'IT', 'AT', 'PL', 'CZ', 'RO', 'HU', 'SE', 'DK', 'FI', 'EE', 'LT', 'LV', 'GR', 'IE'],
  EUROPE: ['GB', 'CH', 'NO', 'UA', 'TR', 'DE', 'FR', 'NL', 'BE', 'ES', 'PT', 'IT', 'AT', 'PL', 'CZ', 'RO', 'HU', 'SE', 'DK', 'FI', 'EE', 'LT', 'LV', 'GR', 'IE'],
  EMEA: ['GB', 'CH', 'NO', 'UA', 'TR', 'DE', 'FR', 'NL', 'BE', 'ES', 'PT', 'IT', 'AT', 'PL', 'CZ', 'RO', 'HU', 'SE', 'DK', 'FI', 'EE', 'LT', 'LV', 'GR', 'IE', 'IL', 'AE', 'SA', 'EG', 'NG', 'KE', 'ZA'],
  MENA: ['AE', 'SA', 'EG', 'IL', 'TR'],
  AFRICA: ['EG', 'NG', 'KE', 'ZA'],
  APAC: ['IN', 'PK', 'BD', 'LK', 'NP', 'SG', 'MY', 'ID', 'TH', 'VN', 'PH', 'HK', 'TW', 'CN', 'JP', 'KR', 'AU', 'NZ'],
  ASIA: ['IN', 'PK', 'BD', 'LK', 'NP', 'SG', 'MY', 'ID', 'TH', 'VN', 'PH', 'HK', 'TW', 'CN', 'JP', 'KR', 'AE', 'SA', 'IL', 'TR'],
  SOUTH_ASIA: ['IN', 'PK', 'BD', 'LK', 'NP'],
  SEA: ['SG', 'MY', 'ID', 'TH', 'VN', 'PH'],
  OCEANIA: ['AU', 'NZ'],
  ANZ: ['AU', 'NZ'],
  NA: ['US', 'CA', 'MX'],
  AMERICAS: ['US', 'CA', 'MX', 'BR', 'AR', 'CO', 'CL'],
  LATAM: ['MX', 'BR', 'AR', 'CO', 'CL'],
  UKI: ['GB', 'IE'],
  DACH: ['DE', 'AT', 'CH'],
  NORDICS: ['SE', 'NO', 'DK', 'FI'],
  BENELUX: ['BE', 'NL'],
  CEE: ['PL', 'CZ', 'RO', 'HU', 'UA', 'EE', 'LT', 'LV'],
}

/** Phrase aliases → region token (matched case-insensitively, word-bounded). */
export const REGION_ALIASES: Array<[RegExp, string]> = [
  [/\b(worldwide|world-wide|global(ly)?|anywhere in the world|work from anywhere|from anywhere|any(where| location| country)|all countries|open to all countries|international candidates?|all time ?zones?|any time ?zone)\b/i, 'WORLDWIDE'],
  [/\b(apac|asia[- ]pacific)\b/i, 'APAC'],
  [/\b(emea)\b/i, 'EMEA'],
  [/\b(european union|eu)\b/i, 'EU'],
  [/\b(europe|european)\b/i, 'EUROPE'],
  [/\b(latam|latin america)\b/i, 'LATAM'],
  [/\b(north america)\b/i, 'NA'],
  [/\b(americas)\b/i, 'AMERICAS'],
  [/\b(mena|middle east)\b/i, 'MENA'],
  [/\b(south ?east asia)\b/i, 'SEA'],
  [/\b(south asia)\b/i, 'SOUTH_ASIA'],
  [/\b(asia)\b/i, 'ASIA'],
  [/\b(africa)\b/i, 'AFRICA'],
  [/\b(oceania|anz|australia and new zealand)\b/i, 'ANZ'],
  [/\b(uk ?& ?i|uk and ireland)\b/i, 'UKI'],
  [/\b(dach)\b/i, 'DACH'],
  [/\b(nordics?|scandinavia)\b/i, 'NORDICS'],
  [/\b(benelux)\b/i, 'BENELUX'],
  [/\b(cee|central and eastern europe|eastern europe)\b/i, 'CEE'],
]

export interface MetroDef { id: string; country: string; label: string; aliases: string[]; tz?: number }

export const METROS: MetroDef[] = [
  // India
  { id: 'delhi-ncr', country: 'IN', label: 'Delhi NCR', aliases: ['delhi', 'new delhi', 'delhi ncr', 'ncr', 'gurugram', 'gurgaon', 'noida', 'greater noida', 'faridabad', 'ghaziabad'] },
  { id: 'bengaluru', country: 'IN', label: 'Bengaluru', aliases: ['bengaluru', 'bangalore', 'blr'] },
  { id: 'hyderabad', country: 'IN', label: 'Hyderabad', aliases: ['hyderabad', 'hyd'] },
  { id: 'pune', country: 'IN', label: 'Pune', aliases: ['pune'] },
  { id: 'mumbai', country: 'IN', label: 'Mumbai', aliases: ['mumbai', 'bombay', 'navi mumbai', 'thane'] },
  { id: 'chennai', country: 'IN', label: 'Chennai', aliases: ['chennai', 'madras'] },
  { id: 'kolkata', country: 'IN', label: 'Kolkata', aliases: ['kolkata', 'calcutta'] },
  { id: 'ahmedabad', country: 'IN', label: 'Ahmedabad', aliases: ['ahmedabad', 'gandhinagar'] },
  { id: 'jaipur', country: 'IN', label: 'Jaipur', aliases: ['jaipur'] },
  { id: 'chandigarh', country: 'IN', label: 'Chandigarh', aliases: ['chandigarh', 'mohali'] },
  { id: 'indore', country: 'IN', label: 'Indore', aliases: ['indore'] },
  { id: 'kochi', country: 'IN', label: 'Kochi', aliases: ['kochi', 'cochin', 'thiruvananthapuram', 'trivandrum'] },
  { id: 'coimbatore', country: 'IN', label: 'Coimbatore', aliases: ['coimbatore'] },
  // Americas
  { id: 'sf-bay-area', country: 'US', label: 'SF Bay Area', aliases: ['san francisco', 'sf bay area', 'bay area', 'palo alto', 'mountain view', 'menlo park', 'san jose', 'sunnyvale', 'redwood city', 'oakland'], tz: -8 },
  { id: 'new-york', country: 'US', label: 'New York', aliases: ['new york', 'nyc', 'new york city', 'brooklyn', 'manhattan'], tz: -5 },
  { id: 'seattle', country: 'US', label: 'Seattle', aliases: ['seattle', 'bellevue', 'redmond'], tz: -8 },
  { id: 'austin', country: 'US', label: 'Austin', aliases: ['austin'], tz: -6 },
  { id: 'boston', country: 'US', label: 'Boston', aliases: ['boston', 'cambridge, ma'], tz: -5 },
  { id: 'chicago', country: 'US', label: 'Chicago', aliases: ['chicago'], tz: -6 },
  { id: 'los-angeles', country: 'US', label: 'Los Angeles', aliases: ['los angeles', 'la, ca', 'santa monica'], tz: -8 },
  { id: 'denver', country: 'US', label: 'Denver', aliases: ['denver', 'boulder'], tz: -7 },
  { id: 'toronto', country: 'CA', label: 'Toronto', aliases: ['toronto', 'waterloo'], tz: -5 },
  { id: 'vancouver', country: 'CA', label: 'Vancouver', aliases: ['vancouver'], tz: -8 },
  { id: 'sao-paulo', country: 'BR', label: 'São Paulo', aliases: ['são paulo', 'sao paulo'], tz: -3 },
  { id: 'mexico-city', country: 'MX', label: 'Mexico City', aliases: ['mexico city', 'cdmx'], tz: -6 },
  // Europe / MEA
  { id: 'london', country: 'GB', label: 'London', aliases: ['london'], tz: 0 },
  { id: 'dublin', country: 'IE', label: 'Dublin', aliases: ['dublin'], tz: 0 },
  { id: 'berlin', country: 'DE', label: 'Berlin', aliases: ['berlin'], tz: 1 },
  { id: 'munich', country: 'DE', label: 'Munich', aliases: ['munich', 'münchen'], tz: 1 },
  { id: 'amsterdam', country: 'NL', label: 'Amsterdam', aliases: ['amsterdam', 'utrecht', 'rotterdam'], tz: 1 },
  { id: 'paris', country: 'FR', label: 'Paris', aliases: ['paris'], tz: 1 },
  { id: 'madrid', country: 'ES', label: 'Madrid', aliases: ['madrid'], tz: 1 },
  { id: 'barcelona', country: 'ES', label: 'Barcelona', aliases: ['barcelona'], tz: 1 },
  { id: 'lisbon', country: 'PT', label: 'Lisbon', aliases: ['lisbon', 'lisboa', 'porto'], tz: 0 },
  { id: 'zurich', country: 'CH', label: 'Zurich', aliases: ['zurich', 'zürich'], tz: 1 },
  { id: 'warsaw', country: 'PL', label: 'Warsaw', aliases: ['warsaw', 'warszawa', 'krakow', 'kraków', 'wroclaw'], tz: 1 },
  { id: 'stockholm', country: 'SE', label: 'Stockholm', aliases: ['stockholm'], tz: 1 },
  { id: 'copenhagen', country: 'DK', label: 'Copenhagen', aliases: ['copenhagen'], tz: 1 },
  { id: 'tel-aviv', country: 'IL', label: 'Tel Aviv', aliases: ['tel aviv'], tz: 2 },
  { id: 'dubai', country: 'AE', label: 'Dubai', aliases: ['dubai', 'abu dhabi'], tz: 4 },
  // APAC
  { id: 'singapore', country: 'SG', label: 'Singapore', aliases: ['singapore'], tz: 8 },
  { id: 'sydney', country: 'AU', label: 'Sydney', aliases: ['sydney'], tz: 10 },
  { id: 'melbourne', country: 'AU', label: 'Melbourne', aliases: ['melbourne'], tz: 10 },
  { id: 'tokyo', country: 'JP', label: 'Tokyo', aliases: ['tokyo'], tz: 9 },
  { id: 'hong-kong', country: 'HK', label: 'Hong Kong', aliases: ['hong kong'], tz: 8 },
]

/** Time-zone tokens → UTC offset (hours). */
export const TZ_TOKENS: Array<[RegExp, number]> = [
  [/\b(ist|india standard time)\b/i, 5.5],
  [/\b(cet|central european(?: time)?)\b/i, 1],
  [/\b(cest)\b/i, 2],
  [/\b(eet)\b/i, 2],
  [/\b(gmt|utc|bst|uk (?:time|hours))\b/i, 0],
  [/\b(est|et|eastern(?: time| standard time)?)\b/i, -5],
  [/\b(cst|ct|central(?: time| standard time)?)\b/i, -6],
  [/\b(mst|mt|mountain(?: time)?)\b/i, -7],
  [/\b(pst|pt|pacific(?: time| standard time)?)\b/i, -8],
  [/\b(aest|aedt)\b/i, 10],
  [/\b(sgt)\b/i, 8],
  [/\b(jst)\b/i, 9],
  [/\b(gst)\b/i, 4],
]

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export const COUNTRY_RE: Array<[RegExp, string]> = COUNTRIES.map((c) => [new RegExp(`(^|[^a-z])(${c.aliases.map(escape).join('|')})(?=$|[^a-z])`, 'i'), c.code])
export const METRO_RE: Array<[RegExp, MetroDef]> = METROS.map((m) => [new RegExp(`(^|[^a-z])(${m.aliases.map(escape).join('|')})(?=$|[^a-z])`, 'i'), m])
const byCode = new Map(COUNTRIES.map((c) => [c.code, c]))
export const countryDef = (code: string): CountryDef | undefined => byCode.get(code.toUpperCase())
export const metroDef = (id: string): MetroDef | undefined => METROS.find((m) => m.id === id)

/** Countries covered by a list of allow tokens (ISO-2 codes and/or region tokens). */
export function expandRegions(tokens: string[]): Set<string> {
  const out = new Set<string>()
  for (const t of tokens) {
    const up = t.toUpperCase()
    if (REGIONS[up]) for (const c of REGIONS[up]) out.add(c)
    else out.add(up)
  }
  return out
}

/** True when `country` is covered by `tokens` (WORLDWIDE covers everyone). */
export function coversCountry(tokens: string[], country: string): boolean {
  if (!tokens.length) return false
  if (tokens.some((t) => t.toUpperCase() === 'WORLDWIDE')) return true
  return expandRegions(tokens).has(country.toUpperCase())
}
