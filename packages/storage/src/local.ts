import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import type { ObjectMeta, ObjectStore, PutOptions } from './types.js'
import { assertSafeKey } from './types.js'

export interface LocalFsOptions {
  root: string
  /** Secret for HMAC-signed download URLs. */
  signingSecret: string
  /** Route that serves signed files (apps/web `app/api/files/route.ts`). */
  publicPath?: string
  /** Optional at-rest encryption (AES-256-GCM). Any string; hashed to a 32-byte key. Files written without it stay readable. */
  encryptionKey?: string | null
}

const ENC_MAGIC = Buffer.from('JRENC1')

interface Sidecar {
  contentType: string | null
  filename: string | null
  size: number
}

/**
 * Files under `root`, one `.meta.json` sidecar per object. Signed URLs: `<publicPath>?key=&exp=&sig=`
 * verified by `verifySignedQuery()` in the web route. Good enough for the single-user deployment; use the
 * S3 driver for anything shared.
 */
export class LocalFsStore implements ObjectStore {
  readonly driver = 'local' as const
  private readonly root: string
  private readonly publicPath: string
  private readonly key: Buffer | null

  constructor(private readonly opts: LocalFsOptions) {
    if (!opts.signingSecret || opts.signingSecret.length < 16) throw new Error('LocalFsStore: signingSecret must be at least 16 chars')
    this.root = resolve(opts.root)
    this.publicPath = opts.publicPath ?? '/api/files'
    this.key = opts.encryptionKey ? createHash('sha256').update(opts.encryptionKey).digest() : null
  }

  private seal(plain: Buffer): Buffer {
    if (!this.key) return plain
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const body = Buffer.concat([cipher.update(plain), cipher.final()])
    return Buffer.concat([ENC_MAGIC, iv, cipher.getAuthTag(), body])
  }

  private open(stored: Buffer): Buffer {
    if (stored.length < ENC_MAGIC.length + 28 || !stored.subarray(0, ENC_MAGIC.length).equals(ENC_MAGIC)) return stored // legacy plaintext
    if (!this.key) throw new Error('LocalFsStore: object is encrypted but STORAGE_ENCRYPTION_KEY is not set')
    const iv = stored.subarray(6, 18), tag = stored.subarray(18, 34), body = stored.subarray(34)
    const d = createDecipheriv('aes-256-gcm', this.key, iv)
    d.setAuthTag(tag)
    return Buffer.concat([d.update(body), d.final()])
  }

  private pathFor(key: string): string {
    assertSafeKey(key)
    const p = resolve(join(this.root, key))
    if (!p.startsWith(this.root + sep)) throw new Error('Unsafe object key (escapes root)')
    return p
  }

  async put(key: string, body: Buffer, opts: PutOptions = {}): Promise<ObjectMeta> {
    const p = this.pathFor(key)
    await fs.mkdir(dirname(p), { recursive: true })
    const tmp = `${p}.tmp-${process.pid}-${Date.now()}`
    await fs.writeFile(tmp, this.seal(body), { mode: 0o600 })
    await fs.rename(tmp, p)
    const meta: Sidecar = { contentType: opts.contentType ?? null, filename: opts.filename ?? null, size: body.length }
    await fs.writeFile(`${p}.meta.json`, JSON.stringify(meta), { mode: 0o600 })
    return { key, size: body.length, contentType: meta.contentType, filename: meta.filename }
  }

  async get(key: string): Promise<Buffer> {
    return this.open(await fs.readFile(this.pathFor(key)))
  }

  async head(key: string): Promise<ObjectMeta | null> {
    const p = this.pathFor(key)
    try {
      const st = await fs.stat(p)
      let side: Partial<Sidecar> = {}
      try { side = JSON.parse(await fs.readFile(`${p}.meta.json`, 'utf8')) } catch { /* no sidecar */ }
      return { key, size: side.size ?? st.size, contentType: side.contentType ?? null, filename: side.filename ?? null }
    } catch {
      return null
    }
  }

  /** Modification time (ms) or null — used by orphan sweeps to respect a grace window. */
  async mtime(key: string): Promise<number | null> {
    try { return (await fs.stat(this.pathFor(key))).mtimeMs } catch { return null }
  }

  async delete(key: string): Promise<void> {
    const p = this.pathFor(key)
    await fs.rm(p, { force: true })
    await fs.rm(`${p}.meta.json`, { force: true })
  }

  async deletePrefix(prefix: string): Promise<number> {
    assertSafeKey(prefix)
    const dir = this.pathFor(prefix)
    let n = 0
    const walk = async (d: string): Promise<void> => {
      let entries: import('node:fs').Dirent[]
      try { entries = await fs.readdir(d, { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        const p = join(d, e.name)
        if (e.isDirectory()) await walk(p)
        else if (!e.name.endsWith('.meta.json')) n++
      }
    }
    await walk(dir)
    await fs.rm(dir, { recursive: true, force: true })
    return n
  }

  async list(prefix: string, limit = 10_000): Promise<string[]> {
    assertSafeKey(prefix)
    const dir = this.pathFor(prefix)
    const out: string[] = []
    const walk = async (d: string): Promise<void> => {
      let entries: import('node:fs').Dirent[]
      try { entries = await fs.readdir(d, { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        if (out.length >= limit) return
        const p = join(d, e.name)
        if (e.isDirectory()) await walk(p)
        else if (!e.name.endsWith('.meta.json') && !/\.tmp-\d+-\d+$/.test(e.name)) out.push(p.slice(this.root.length + 1).split(sep).join('/'))
      }
    }
    await walk(dir)
    return out
  }

  async signedUrl(key: string, ttlSeconds = 600): Promise<string> {
    assertSafeKey(key)
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds
    const sig = sign(this.opts.signingSecret, key, exp)
    const q = new URLSearchParams({ key, exp: String(exp), sig })
    return `${this.publicPath}?${q.toString()}`
  }
}

export function sign(secret: string, key: string, exp: number): string {
  return createHmac('sha256', secret).update(`${key}\n${exp}`).digest('base64url')
}

/** Verify `key/exp/sig` from a signed local URL. Returns the key or null. */
export function verifySignedQuery(secret: string, q: { key?: string | null; exp?: string | null; sig?: string | null }, now = Date.now()): string | null {
  if (!q.key || !q.exp || !q.sig) return null
  const exp = parseInt(q.exp, 10)
  if (!Number.isFinite(exp) || exp * 1000 < now) return null
  const expected = Buffer.from(sign(secret, q.key, exp))
  const given = Buffer.from(q.sig)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  try { assertSafeKey(q.key) } catch { return null }
  return q.key
}
