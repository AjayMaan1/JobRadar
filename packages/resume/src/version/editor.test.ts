import { describe, expect, it } from 'vitest'
import { diffContent, groundChanges, textToBullets, bulletsToText, textToKeywords, setAt, getAt } from './editor.js'
import { ResumeContentSchema } from '../schema/resume.js'
import { SAMPLE_RESUME } from '../__fixtures__/sample.js'

const base = ResumeContentSchema.parse(SAMPLE_RESUME)

describe('editor helpers (HLD-resume-editor)', () => {
  it('diffContent attributes every change to a JSON pointer', () => {
    let draft = setAt(base, '/basics/label', 'Staff Backend Engineer · Go, Kafka')
    draft = setAt(draft, '/work/0/highlights/0', 'Led the migration of payment services to Kafka, cutting p99 latency 40%')
    draft = setAt(draft, '/skills/0/keywords', [...base.skills[0].keywords, 'gRPC'])
    draft = { ...draft, work: [...draft.work, { name: 'NewCo', position: 'Advisor', highlights: [], keywords: [] }] }
    const d = diffContent(base, draft)
    expect(d.map((c) => c.path)).toEqual(expect.arrayContaining(['/basics/label', '/work/0/highlights/0', '/skills/0/keywords', `/work/${base.work.length}`]))
    expect(d.find((c) => c.path === '/basics/label')).toMatchObject({ before: base.basics.label ?? null })
    expect(diffContent(base, base)).toEqual([])
  })
  it('groundChanges flags claims that are not in the master, but not contact/date fields', () => {
    let draft = setAt(base, '/work/0/highlights/0', 'Architected a Rust rewrite serving 9 billion requests at Google')
    draft = setAt(draft, '/basics/email', 'new@example.com')
    draft = setAt(draft, '/work/0/endDate', '2025-01')
    const g = groundChanges(diffContent(base, draft), base, [])
    expect(g.map((x) => x.path)).toEqual(['/work/0/highlights/0'])
    const values = g[0].result.unsupported.map((u) => u.value)
    expect(values).toEqual(expect.arrayContaining(['Rust']))
    // a confirmed fact makes it supported
    expect(groundChanges(diffContent(base, draft), base, ['Rust rewrite at Google serving 9 billion requests']).length).toBe(0)
    // rephrasing your own bullet is fine
    const same = setAt(base, '/work/0/highlights/0', base.work[0].highlights[0] + ', end to end')
    expect(groundChanges(diffContent(base, same), base, [])).toEqual([])
  })
  it('bullet / keyword text round-trips and JSON pointers work', () => {
    expect(textToBullets('- one\n• two\n\nthree ')).toEqual(['one', 'two', 'three'])
    expect(bulletsToText(['a', 'b'])).toBe('a\nb')
    expect(textToKeywords('Go, Kafka,, Go\ngRPC')).toEqual(['Go', 'Kafka', 'gRPC'])
    expect(getAt(base, '/work/0/position')).toBe(base.work[0].position)
    expect(getAt(setAt(base, '/projects/0/name', 'X'), '/projects/0/name')).toBe('X')
  })
})
