export { ExtractorService } from './extractor.service.js'
export type { ProcessContext, ProcessResult } from './extractor.service.js'
export { DedupeService } from './dedupe.js'
export type { UpsertResult, UpsertExtras } from './dedupe.js'
export { normalizeJob, buildCanonicalHash, normalizeApplyUrl } from './normalizer.js'
export type { NormalizeSource } from './normalizer.js'
export { deterministicExtract } from './deterministic.js'
export { llmExtract } from './llm-extractor.js'
export { parseSalary } from './salary-parser.js'
export { detectEligibility } from './eligibility-detector.js'
export { toINR, annualize } from './currency-converter.js'
export {
  classifyOpportunity,
  detectEmploymentType,
  isNcrLocation,
  findRestriction,
  findIndiaOk,
} from './classifier.js'
export type { ClassifierInput, ClassifierResult, ClassifierCompany, OpportunityClassValue, EmploymentTypeValue } from './classifier.js'
export type { ParsedSalary } from './salary-parser.js'
export type { EligibilityResult, EligibilityType } from './eligibility-detector.js'
export type { ExtractedJob } from './deterministic.js'
export type { NormalizedJob } from './normalizer.js'
export { extractJobFacts, eligibleFor, parseLocations, FACTS_VERSION } from './geo/facts.js'
export type { JobFacts, GeoFacts, JobLocation, WorkMode, FactsInput } from './geo/facts.js'
export { COUNTRIES, REGIONS, METROS, expandRegions, coversCountry, countryDef, metroDef } from './geo/dictionary.js'
export type { CountryDef, MetroDef } from './geo/dictionary.js'
export { toUSD, fromUSD, SUPPORTED_CURRENCIES } from './currency-converter.js'
