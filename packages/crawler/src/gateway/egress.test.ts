import { describe, it, expect } from 'vitest'
import { assertPublicUrl, isPrivateIp, EgressBlockedError, readBodyCapped, _resetEgressCache } from './egress.js'

describe('egress guard (audit NEW-27)', () => {
  it('classifies private / special addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1']) expect(isPrivateIp(ip), ip).toBe(true)
    for (const ip of ['8.8.8.8', '172.32.0.1', '1.1.1.1', '2606:4700::1111', '::ffff:8.8.8.8']) expect(isPrivateIp(ip), ip).toBe(false)
  })
  it('blocks schemes, internal names, literal private IPs and credentials', async () => {
    _resetEgressCache()
    for (const u of ['file:///etc/passwd', 'ftp://x', 'http://localhost:11434/api/tags', 'http://ollama.local/', 'http://db.internal/', 'http://127.0.0.1:6379/', 'http://[::1]:9464/metrics', 'http://169.254.169.254/latest/meta-data/', 'http://user:pw@example.com/'])
      await expect(assertPublicUrl(u, { allowPrivate: false })).rejects.toBeInstanceOf(EgressBlockedError)
  })
  it('blocks names that resolve to private addresses (incl. mixed public+private) and caches the verdict', async () => {
    _resetEgressCache()
    let calls = 0
    const resolver = async (h: string) => { calls++; return h === 'evil.example' ? [{ address: '93.184.216.34' }, { address: '10.0.0.5' }] : [{ address: '93.184.216.34' }] }
    await expect(assertPublicUrl('https://evil.example/jobs', { allowPrivate: false, resolver })).rejects.toThrow(/private address 10\.0\.0\.5/)
    await expect(assertPublicUrl('https://evil.example/other', { allowPrivate: false, resolver })).rejects.toThrow(/private/)
    expect(calls).toBe(1) // cached
    await assertPublicUrl('https://boards-api.greenhouse.io/v1/boards/x/jobs', { allowPrivate: false, resolver })
  })
  it('lets unresolvable names through (fetch fails on its own; sandbox fake fetch keeps working)', async () => {
    _resetEgressCache()
    await assertPublicUrl('https://does-not-exist.invalid/', { allowPrivate: false, resolver: async () => { throw new Error('ENOTFOUND') } })
  })
  it('readBodyCapped truncates oversized bodies', async () => {
    const big = new Response('x'.repeat(5000))
    expect((await readBodyCapped(big, 1000)).truncated).toBe(true)
    const small = new Response('hello')
    expect(await readBodyCapped(small, 1000)).toEqual({ text: 'hello', truncated: false })
    const declared = new Response('hello', { headers: { 'content-length': '999999' } })
    expect((await readBodyCapped(declared, 1000)).truncated).toBe(true)
  })
})
