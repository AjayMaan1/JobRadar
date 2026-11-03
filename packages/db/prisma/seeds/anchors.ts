/**
 * Curated anchor companies. Polled hot, exempt from activity-based demotion.
 * ATS assignments are hints — the resolver verifies every board by probing before polling.
 * `atsSlug` null => company is created without a board (status=unresolved) until a
 * custom_json adapter or a careers URL resolution exists.
 */
export interface AnchorSeed {
  name: string
  domain: string
  hqCountry: string
  ats?: 'greenhouse' | 'lever' | 'ashby' | 'workable' | 'smartrecruiters' | 'workday'
  slug?: string
  careersUrl?: string
  tags: string[]
  /** Workday only: scoped query so we never pull the full board */
  queryScope?: { searchText?: string }
}

const GLOBAL: AnchorSeed[] = [
  { name: 'Atlassian',      domain: 'atlassian.com',   hqCountry: 'AU', ats: 'lever',      slug: 'atlassian',  tags: ['anchor','big_tech','remote_first'] },
  { name: 'Airbnb',         domain: 'airbnb.com',      hqCountry: 'US', ats: 'greenhouse', slug: 'airbnb',     tags: ['anchor','big_tech','mnc'] },
  { name: 'GitLab',         domain: 'gitlab.com',      hqCountry: 'US', ats: 'greenhouse', slug: 'gitlab',     tags: ['anchor','remote_first'] },
  { name: 'Stripe',         domain: 'stripe.com',      hqCountry: 'US', ats: 'greenhouse', slug: 'stripe',     tags: ['anchor','big_tech'] },
  { name: 'Coinbase',       domain: 'coinbase.com',    hqCountry: 'US', ats: 'greenhouse', slug: 'coinbase',   tags: ['anchor','remote_first'] },
  { name: 'Dropbox',        domain: 'dropbox.com',     hqCountry: 'US', ats: 'greenhouse', slug: 'dropbox',    tags: ['anchor','big_tech','remote_first'] },
  { name: 'Cloudflare',     domain: 'cloudflare.com',  hqCountry: 'US', ats: 'greenhouse', slug: 'cloudflare', tags: ['anchor','big_tech'] },
  { name: 'Datadog',        domain: 'datadoghq.com',   hqCountry: 'US', ats: 'greenhouse', slug: 'datadog',    tags: ['anchor'] },
  { name: 'HashiCorp',      domain: 'hashicorp.com',   hqCountry: 'US', ats: 'greenhouse', slug: 'hashicorp',  tags: ['anchor','remote_first'] },
  { name: 'MongoDB',        domain: 'mongodb.com',     hqCountry: 'US', ats: 'greenhouse', slug: 'mongodb',    tags: ['anchor','mnc'] },
  { name: 'Elastic',        domain: 'elastic.co',      hqCountry: 'NL', ats: 'greenhouse', slug: 'elastic',    tags: ['anchor','remote_first'] },
  { name: 'Confluent',      domain: 'confluent.io',    hqCountry: 'US', ats: 'greenhouse', slug: 'confluent',  tags: ['anchor'] },
  { name: 'Grafana Labs',   domain: 'grafana.com',     hqCountry: 'US', ats: 'greenhouse', slug: 'grafanalabs', tags: ['anchor','remote_first'] },
  { name: 'Zapier',         domain: 'zapier.com',      hqCountry: 'US', ats: 'greenhouse', slug: 'zapier',     tags: ['anchor','remote_first'] },
  { name: 'Automattic',     domain: 'automattic.com',  hqCountry: 'US', ats: 'greenhouse', slug: 'automattic', tags: ['anchor','remote_first'] },
  { name: 'Doist',          domain: 'doist.com',       hqCountry: 'PT', careersUrl: 'https://doist.com/careers', tags: ['anchor','remote_first'] },
  { name: 'Buffer',         domain: 'buffer.com',      hqCountry: 'US', careersUrl: 'https://buffer.com/journey', tags: ['anchor','remote_first'] },
  { name: 'Canonical',      domain: 'canonical.com',   hqCountry: 'GB', ats: 'greenhouse', slug: 'canonical',  tags: ['anchor','remote_first'] },
  { name: 'Canva',          domain: 'canva.com',       hqCountry: 'AU', ats: 'lever',      slug: 'canva',      tags: ['anchor','big_tech'] },
  { name: 'Reddit',         domain: 'redditinc.com',   hqCountry: 'US', ats: 'greenhouse', slug: 'reddit',     tags: ['anchor','big_tech'] },
  { name: 'Pinterest',      domain: 'pinterest.com',   hqCountry: 'US', ats: 'greenhouse', slug: 'pinterest',  tags: ['anchor','big_tech'] },
  { name: 'Twilio',         domain: 'twilio.com',      hqCountry: 'US', ats: 'greenhouse', slug: 'twilio',     tags: ['anchor','mnc'] },
  { name: 'Figma',          domain: 'figma.com',       hqCountry: 'US', ats: 'greenhouse', slug: 'figma',      tags: ['anchor','big_tech'] },
  { name: 'Databricks',     domain: 'databricks.com',  hqCountry: 'US', ats: 'greenhouse', slug: 'databricks', tags: ['anchor','big_tech'] },
  { name: 'Notion',         domain: 'notion.so',       hqCountry: 'US', ats: 'ashby',      slug: 'notion',     tags: ['anchor'] },
  { name: 'OpenAI',         domain: 'openai.com',      hqCountry: 'US', ats: 'ashby',      slug: 'openai',     tags: ['anchor','big_tech'] },
  { name: 'Anthropic',      domain: 'anthropic.com',   hqCountry: 'US', ats: 'greenhouse', slug: 'anthropic',  tags: ['anchor'] },
  { name: 'Vercel',         domain: 'vercel.com',      hqCountry: 'US', ats: 'greenhouse', slug: 'vercel',     tags: ['anchor','remote_first'] },
  { name: 'Supabase',       domain: 'supabase.com',    hqCountry: 'US', ats: 'ashby',      slug: 'supabase',   tags: ['anchor','remote_first'] },
  { name: 'PostHog',        domain: 'posthog.com',     hqCountry: 'US', ats: 'ashby',      slug: 'posthog',    tags: ['anchor','remote_first'] },
  { name: 'Remote.com',     domain: 'remote.com',      hqCountry: 'US', ats: 'greenhouse', slug: 'remotecom',  tags: ['anchor','remote_first'] },
  { name: 'Deel',           domain: 'deel.com',        hqCountry: 'US', ats: 'ashby',      slug: 'deel',       tags: ['anchor','remote_first'] },
  { name: 'Shopify',        domain: 'shopify.com',     hqCountry: 'CA', careersUrl: 'https://www.shopify.com/careers', tags: ['anchor','big_tech','remote_first'] },
  { name: 'Spotify',        domain: 'spotify.com',     hqCountry: 'SE', ats: 'lever',      slug: 'spotify',    tags: ['anchor','big_tech'] },
  { name: 'GitHub',         domain: 'github.com',      hqCountry: 'US', careersUrl: 'https://www.github.careers/careers-home', tags: ['anchor','big_tech','remote_first'] },
]

// Delhi-NCR MNC anchors (P3 = hybrid only)
const NCR: AnchorSeed[] = [
  { name: 'Adobe',              domain: 'adobe.com',          hqCountry: 'US', ats: 'workday', slug: 'adobe.wd5.myworkdayjobs.com/external_experienced', tags: ['anchor','mnc','big_tech'], queryScope: { searchText: 'Noida' } },
  { name: 'Mastercard',         domain: 'mastercard.com',     hqCountry: 'US', ats: 'workday', slug: 'mastercard.wd1.myworkdayjobs.com/CorporateCareers', tags: ['anchor','mnc'], queryScope: { searchText: 'Gurgaon' } },
  { name: 'Optum',              domain: 'optum.com',          hqCountry: 'US', ats: 'workday', slug: 'unitedhealthgroup.wd5.myworkdayjobs.com/External', tags: ['anchor','mnc'], queryScope: { searchText: 'Gurgaon' } },
  { name: 'Gartner',            domain: 'gartner.com',        hqCountry: 'US', ats: 'workday', slug: 'gartner.wd5.myworkdayjobs.com/EXT', tags: ['anchor','mnc'], queryScope: { searchText: 'Gurgaon' } },
  { name: 'Ciena',              domain: 'ciena.com',          hqCountry: 'US', ats: 'workday', slug: 'ciena.wd5.myworkdayjobs.com/Careers', tags: ['anchor','mnc'], queryScope: { searchText: 'Gurgaon' } },
  { name: 'Publicis Sapient',   domain: 'publicissapient.com', hqCountry: 'FR', ats: 'workday', slug: 'publicissapient.wd3.myworkdayjobs.com/PublicisSapient', tags: ['anchor','mnc'], queryScope: { searchText: 'Gurgaon' } },
  { name: 'Expedia Group',      domain: 'expediagroup.com',   hqCountry: 'US', careersUrl: 'https://careers.expediagroup.com/jobs/', tags: ['anchor','mnc','big_tech'] },
  { name: 'Microsoft',          domain: 'microsoft.com',      hqCountry: 'US', careersUrl: 'https://jobs.careers.microsoft.com/global/en/search?lc=Gurugram%2C%20Haryana%2C%20India', tags: ['anchor','mnc','big_tech'] },
  { name: 'Google',             domain: 'google.com',         hqCountry: 'US', careersUrl: 'https://www.google.com/about/careers/applications/jobs/results/?location=Gurugram%2C%20India', tags: ['anchor','mnc','big_tech'] },
  { name: 'Amazon',             domain: 'amazon.com',         hqCountry: 'US', careersUrl: 'https://www.amazon.jobs/en/search?base_query=&loc_query=Gurugram', tags: ['anchor','mnc','big_tech'] },
  { name: 'American Express',   domain: 'americanexpress.com', hqCountry: 'US', careersUrl: 'https://aexp.eightfold.ai/careers?location=Gurgaon', tags: ['anchor','mnc'] },
  { name: 'Oracle',             domain: 'oracle.com',         hqCountry: 'US', careersUrl: 'https://careers.oracle.com/jobs/#en/sites/jobsearch/requisitions?location=India', tags: ['anchor','mnc','big_tech'] },
  { name: 'SAP',                domain: 'sap.com',            hqCountry: 'DE', careersUrl: 'https://jobs.sap.com/search/?q=&locationsearch=Gurgaon', tags: ['anchor','mnc','big_tech'] },
  { name: 'Samsung R&D India',  domain: 'samsung.com',        hqCountry: 'KR', careersUrl: 'https://www.samsung.com/in/about-us/careers/', tags: ['anchor','mnc','big_tech'] },
  { name: 'Sprinklr',           domain: 'sprinklr.com',       hqCountry: 'US', careersUrl: 'https://www.sprinklr.com/careers/', tags: ['anchor','mnc'] },
  { name: 'Cvent',              domain: 'cvent.com',          hqCountry: 'US', ats: 'greenhouse', slug: 'cvent', tags: ['anchor','mnc'] },
  { name: 'Tower Research Capital', domain: 'tower-research.com', hqCountry: 'US', ats: 'greenhouse', slug: 'towerresearchcapital', tags: ['anchor','mnc'] },
  { name: 'Nagarro',            domain: 'nagarro.com',        hqCountry: 'DE', careersUrl: 'https://www.nagarro.com/en/careers', tags: ['anchor','mnc'] },
  { name: 'Boston Consulting Group', domain: 'bcg.com',       hqCountry: 'US', careersUrl: 'https://careers.bcg.com/global/en/search-results?keywords=software%20engineer&location=Gurugram', tags: ['anchor','mnc'] },
  { name: 'ZS Associates',      domain: 'zs.com',             hqCountry: 'US', careersUrl: 'https://jobs.zs.com/search-jobs/Gurugram', tags: ['anchor','mnc'] },
]

export const ANCHORS: AnchorSeed[] = [...GLOBAL, ...NCR]
