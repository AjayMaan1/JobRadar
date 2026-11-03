import type { FetchGateway } from '../gateway/index.js'
import { atsRefFromUrl } from '../ats-urls.js'
import { domainFromUrl, type DiscoveryCandidate } from './types.js'

interface ListSpec { ref: string; url: string; parse: (md: string) => Array<{ name: string; url: string | null; region?: string | null }> }

/** remoteintech/remote-jobs: markdown table  | Name | Website | Region | */
function parseRemoteJobsTable(md: string) {
  const rows: Array<{ name: string; url: string | null; region?: string | null }> = []
  for (const line of md.split('\n')) {
    if (!line.startsWith('|')) continue
    const cells = line.split('|').map((c) => c.trim())
    if (cells.length < 4) continue
    const m = cells[1].match(/\[([^\]]+)\]\(([^)]+)\)/)
    if (!m) continue
    rows.push({ name: m[1].trim(), url: cells[2].replace(/[<>]/g, '').trim() || m[2], region: cells[3] || null })
  }
  return rows
}

/** poteto/hiring-without-whiteboards: "- [Company](url) | Location | notes" */
function parseBulletList(md: string) {
  const rows: Array<{ name: string; url: string | null; region?: string | null }> = []
  for (const line of md.split('\n')) {
    const m = line.match(/^\s*[-*]\s+\[([^\]]+)\]\(([^)]+)\)\s*(?:\|\s*([^|]+))?/)
    if (m) rows.push({ name: m[1].trim(), url: m[2].trim(), region: m[3]?.trim() ?? null })
  }
  return rows
}

const LISTS: ListSpec[] = [
  { ref: 'remoteintech/remote-jobs', url: 'https://raw.githubusercontent.com/remoteintech/remote-jobs/main/README.md', parse: parseRemoteJobsTable },
  { ref: 'poteto/hiring-without-whiteboards', url: 'https://raw.githubusercontent.com/poteto/hiring-without-whiteboards/main/README.md', parse: parseBulletList },
  { ref: 'yanirs/established-remote', url: 'https://raw.githubusercontent.com/yanirs/established-remote/master/README.md', parse: parseBulletList },
]

function regionLooksGlobal(region: string | null | undefined): boolean | null {
  if (!region) return null
  return /worldwide|global|anywhere|remote/i.test(region) && !/\b(us|usa|uk|eu|europe|canada)[- ]?only\b/i.test(region)
}

export async function discoverFromGithubLists(gw: FetchGateway): Promise<DiscoveryCandidate[]> {
  const out: DiscoveryCandidate[] = []
  for (const list of LISTS) {
    const res = await gw.fetch({ url: list.url, purpose: 'discovery', quiet: true, timeoutMs: 30000 })
    if (res.outcome !== 'changed' || !res.body) continue
    for (const row of list.parse(res.body)) {
      const ref = atsRefFromUrl(row.url)
      out.push({
        source: 'github_list',
        externalRef: `${list.ref}:${row.name.toLowerCase()}`,
        nameAsSeen: row.name,
        domainAsSeen: ref ? null : domainFromUrl(row.url),
        careersUrlAsSeen: row.url,
        atsHint: ref && ref.ats !== 'workday' ? ref.ats : null,
        slugHint: ref && ref.ats !== 'workday' ? ref.slug : null,
        remoteHint: regionLooksGlobal(row.region),
        tagsHint: list.ref === 'remoteintech/remote-jobs' ? ['remote_first'] : [],
        payload: { region: row.region ?? null, list: list.ref },
      })
    }
  }
  return out
}
