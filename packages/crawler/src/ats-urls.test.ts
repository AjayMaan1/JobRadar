import { describe, expect, it } from 'vitest'
import { atsRefFromUrl, atsRefsFromHtml, apiUrlFor, costClassFor, normalizeJobUrl } from './ats-urls.js'

describe('atsRefFromUrl', () => {
  it('detects every supported ATS from apply/careers URLs', () => {
    expect(atsRefFromUrl('https://boards.greenhouse.io/gitlab/jobs/123')).toMatchObject({ ats: 'greenhouse', slug: 'gitlab', host: 'boards-api.greenhouse.io' })
    expect(atsRefFromUrl('https://job-boards.greenhouse.io/airbnb')).toMatchObject({ ats: 'greenhouse', slug: 'airbnb' })
    expect(atsRefFromUrl('https://boards.greenhouse.io/embed/job_board/js?for=tinystartup')).toMatchObject({ ats: 'greenhouse', slug: 'tinystartup' })
    expect(atsRefFromUrl('https://jobs.lever.co/atlassian/abc-123/apply')).toMatchObject({ ats: 'lever', slug: 'atlassian' })
    expect(atsRefFromUrl('https://jobs.eu.lever.co/acme')).toMatchObject({ ats: 'lever', slug: 'acme' })
    expect(atsRefFromUrl('https://jobs.ashbyhq.com/openai/uuid')).toMatchObject({ ats: 'ashby', slug: 'openai' })
    expect(atsRefFromUrl('https://apply.workable.com/acme/j/ABC/')).toMatchObject({ ats: 'workable', slug: 'acme' })
    expect(atsRefFromUrl('https://careers.smartrecruiters.com/BoschGroup/743999')).toMatchObject({ ats: 'smartrecruiters', slug: 'BoschGroup' })
    expect(atsRefFromUrl('https://acme.recruitee.com/o/backend')).toMatchObject({ ats: 'recruitee', slug: 'acme' })
    expect(atsRefFromUrl('https://acme.teamtailor.com/jobs/1')).toMatchObject({ ats: 'teamtailor', slug: 'acme' })
    expect(atsRefFromUrl('https://adobe.wd5.myworkdayjobs.com/en-US/external_experienced/job/Noida/x_R1')).toMatchObject({ ats: 'workday', slug: 'adobe.wd5.myworkdayjobs.com/external_experienced', host: 'adobe.wd5.myworkdayjobs.com' })
  })
  it('rejects non-ATS and structural path segments', () => {
    expect(atsRefFromUrl('https://example.com/careers')).toBeNull()
    expect(atsRefFromUrl('https://boards.greenhouse.io/embed')).toBeNull()
    expect(atsRefFromUrl(null)).toBeNull()
  })
  it('scans HTML for embedded boards (script src, iframes, links)', () => {
    const html = '<script src="https://boards.greenhouse.io/embed/job_board/js?for=acme"></script><a href="https://jobs.lever.co/acme-eu">EU</a>'
    const refs = atsRefsFromHtml(html, 'https://acme.com/careers')
    expect(refs.map((r) => `${r.ats}:${r.slug}`).sort()).toEqual(['greenhouse:acme', 'lever:acme-eu'])
  })
})

describe('apiUrlFor / costClassFor', () => {
  it('builds list endpoints', () => {
    expect(apiUrlFor('greenhouse', 'gitlab')).toBe('https://boards-api.greenhouse.io/v1/boards/gitlab/jobs')
    expect(apiUrlFor('lever', 'x')).toBe('https://api.lever.co/v0/postings/x?mode=json')
    expect(apiUrlFor('workday', 'adobe.wd5.myworkdayjobs.com/external_experienced')).toBe('https://adobe.wd5.myworkdayjobs.com/wday/cxs/adobe/external_experienced/jobs')
  })
  it('classes workday as expensive and the big four as cheap', () => {
    expect(costClassFor('workday')).toBe('expensive')
    expect((['greenhouse', 'lever', 'ashby', 'workable'] as const).map((a) => costClassFor(a))).toEqual(['cheap', 'cheap', 'cheap', 'cheap'])
  })
})

describe('normalizeJobUrl', () => {
  it('strips tracking params, fragments and trailing slashes; lowercases', () => {
    expect(normalizeJobUrl('https://Jobs.Lever.co/Acme/1?lever-source=LinkedIn&utm_campaign=x#apply')).toBe('https://jobs.lever.co/acme/1')
    expect(normalizeJobUrl('https://a.b/c/')).toBe('https://a.b/c')
    expect(normalizeJobUrl(null)).toBeNull()
  })
})
