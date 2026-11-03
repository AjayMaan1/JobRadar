import { describe, expect, it } from 'vitest'
import { canonicalizeSkill, findSkills, mentionsSkill } from './aliases.js'

describe('skill aliases', () => {
  it('canonicalises common spellings', () => {
    expect(canonicalizeSkill('k8s')).toBe('Kubernetes')
    expect(canonicalizeSkill('postgres')).toBe('PostgreSQL')
    expect(canonicalizeSkill('NodeJS')).toBe('Node.js')
    expect(canonicalizeSkill('golang')).toBe('Go')
    expect(canonicalizeSkill('Some Unknown Tool')).toBe('Some Unknown Tool')
  })
  it('matches with punctuation-safe boundaries and case rules', () => {
    const hits = findSkills('We use C++, C#, .NET and Node.js; go to the store; Go services; spring weather; Spring Boot apps', { snippets: false })
    const names = hits.map((h) => h.canonical)
    expect(names).toEqual(expect.arrayContaining(['C++', 'C#', '.NET', 'Node.js', 'Go', 'Spring Boot']))
    expect(hits.find((h) => h.canonical === 'Spring')!.count).toBe(1) // from "Spring Boot" only; lowercase "spring weather" must not match
    expect(hits.find((h) => h.canonical === 'Go')!.count).toBe(1) // "go to the store" ignored (case-sensitive alias)
  })
  it('does not match inside other words', () => {
    expect(mentionsSkill('Language: Rustacean', 'Rust')).toBe(0)
    expect(mentionsSkill('Rust, and rust.', 'Rust')).toBe(2)
    expect(mentionsSkill('Javascript and TypeScript', 'Java')).toBe(0)
  })
})
