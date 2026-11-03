import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalFsStore, verifySignedQuery } from './local.js'
import type { ObjectStore } from './types.js'

/** Contract every driver must satisfy. S3Store runs the same suite when S3_TEST_BUCKET is set (not in CI). */
function contract(name: string, make: () => Promise<ObjectStore>) {
  describe(`${name} contract`, () => {
    let store: ObjectStore
    beforeAll(async () => { store = await make() })
    it('put/head/get/delete round-trip', async () => {
      const meta = await store.put('users/u1/resumes/r1/original.pdf', Buffer.from('%PDF-1.4 hello'), { contentType: 'application/pdf', filename: 'cv.pdf' })
      expect(meta.size).toBe(14)
      expect((await store.head('users/u1/resumes/r1/original.pdf'))?.contentType).toBe('application/pdf')
      expect((await store.get('users/u1/resumes/r1/original.pdf')).toString()).toBe('%PDF-1.4 hello')
      await store.delete('users/u1/resumes/r1/original.pdf')
      expect(await store.head('users/u1/resumes/r1/original.pdf')).toBeNull()
    })
    it('deletePrefix erases everything under a user', async () => {
      await store.put('users/u2/a.txt', Buffer.from('a'))
      await store.put('users/u2/deep/b.txt', Buffer.from('b'))
      await store.put('users/u3/c.txt', Buffer.from('c'))
      expect(await store.deletePrefix('users/u2')).toBe(2)
      expect(await store.head('users/u2/a.txt')).toBeNull()
      expect(await store.head('users/u3/c.txt')).not.toBeNull()
    })
    it('rejects unsafe keys', async () => {
      await expect(store.put('../etc/passwd', Buffer.from('x'))).rejects.toThrow(/Unsafe/)
      await expect(store.get('/abs')).rejects.toThrow(/Unsafe/)
    })
  })
}

let dir: string
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'jr-store-')) })
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

contract('LocalFsStore', async () => new LocalFsStore({ root: dir, signingSecret: 'test-secret-0123456789' }))

describe('LocalFsStore signed urls', () => {
  it('signs with expiry and verifies; tampering or expiry fails', async () => {
    const store = new LocalFsStore({ root: dir, signingSecret: 'test-secret-0123456789' })
    const url = await store.signedUrl('users/u1/x.pdf', 60)
    const q = Object.fromEntries(new URL(url, 'http://x').searchParams)
    expect(verifySignedQuery('test-secret-0123456789', q)).toBe('users/u1/x.pdf')
    expect(verifySignedQuery('test-secret-0123456789', { ...q, key: 'users/u2/x.pdf' })).toBeNull()
    expect(verifySignedQuery('other-secret-0123456789', q)).toBeNull()
    expect(verifySignedQuery('test-secret-0123456789', q, Date.now() + 120_000)).toBeNull()
  })
})

describe('LocalFsStore.list / mtime (audit NEW-22 orphan sweeps)', () => {
  it('lists keys under a prefix without sidecars or temp files', async () => {
    const { mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { LocalFsStore } = await import('./local.js')
    const root = mkdtempSync(join(tmpdir(), 'jr-list-'))
    const store = new LocalFsStore({ root, signingSecret: 'list-test-secret-0123456789' })
    await store.put('users/u1/resumes/r1/original.pdf', Buffer.from('a'), { contentType: 'application/pdf' })
    await store.put('users/u1/versions/v1.docx', Buffer.from('b'))
    await store.put('users/u2/resumes/r2/original.pdf', Buffer.from('c'))
    expect((await store.list('users/')).sort()).toEqual(['users/u1/resumes/r1/original.pdf', 'users/u1/versions/v1.docx', 'users/u2/resumes/r2/original.pdf'])
    expect(await store.list('users/u2/')).toEqual(['users/u2/resumes/r2/original.pdf'])
    expect(await store.list('users/', 1)).toHaveLength(1)
    expect(typeof (await store.mtime('users/u1/versions/v1.docx'))).toBe('number')
    expect(await store.mtime('users/nope')).toBeNull()
  })
})
