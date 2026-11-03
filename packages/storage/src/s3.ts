import { DeleteObjectCommand, DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { ObjectMeta, ObjectStore, PutOptions } from './types.js'
import { assertSafeKey } from './types.js'

export interface S3Options {
  bucket: string
  region?: string
  endpoint?: string          // MinIO / R2
  forcePathStyle?: boolean   // MinIO needs true
  accessKeyId?: string
  secretAccessKey?: string
  /** Server-side encryption header (AES256 or aws:kms). */
  sse?: 'AES256' | 'aws:kms'
  client?: S3Client
}

export class S3Store implements ObjectStore {
  readonly driver = 's3' as const
  private readonly client: S3Client

  constructor(private readonly opts: S3Options) {
    if (!opts.bucket) throw new Error('S3Store: bucket is required')
    this.client =
      opts.client ??
      new S3Client({
        region: opts.region ?? 'us-east-1',
        endpoint: opts.endpoint,
        forcePathStyle: opts.forcePathStyle ?? Boolean(opts.endpoint),
        credentials: opts.accessKeyId && opts.secretAccessKey ? { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey } : undefined,
      })
  }

  async put(key: string, body: Buffer, o: PutOptions = {}): Promise<ObjectMeta> {
    assertSafeKey(key)
    await this.client.send(new PutObjectCommand({
      Bucket: this.opts.bucket, Key: key, Body: body, ContentType: o.contentType,
      ContentDisposition: o.filename ? `attachment; filename="${o.filename.replace(/"/g, '')}"` : undefined,
      ServerSideEncryption: this.opts.sse ?? 'AES256',
      Metadata: o.filename ? { filename: o.filename } : undefined,
    }))
    return { key, size: body.length, contentType: o.contentType ?? null, filename: o.filename ?? null }
  }

  async get(key: string): Promise<Buffer> {
    assertSafeKey(key)
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.opts.bucket, Key: key }))
    const bytes = await r.Body?.transformToByteArray()
    if (!bytes) throw new Error(`S3Store: empty body for ${key}`)
    return Buffer.from(bytes)
  }

  async head(key: string): Promise<ObjectMeta | null> {
    assertSafeKey(key)
    try {
      const r = await this.client.send(new HeadObjectCommand({ Bucket: this.opts.bucket, Key: key }))
      return { key, size: r.ContentLength ?? 0, contentType: r.ContentType ?? null, filename: r.Metadata?.filename ?? null }
    } catch (err) {
      if ((err as { name?: string }).name === 'NotFound' || (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null
      throw err
    }
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key)
    await this.client.send(new DeleteObjectCommand({ Bucket: this.opts.bucket, Key: key }))
  }

  async list(prefix: string, limit = 10_000): Promise<string[]> {
    assertSafeKey(prefix)
    const out: string[] = []
    let token: string | undefined
    do {
      const page = await this.client.send(new ListObjectsV2Command({ Bucket: this.opts.bucket, Prefix: prefix, ContinuationToken: token, MaxKeys: Math.min(1000, limit - out.length) }))
      for (const c of page.Contents ?? []) if (c.Key) out.push(c.Key)
      token = page.IsTruncated && out.length < limit ? page.NextContinuationToken : undefined
    } while (token)
    return out
  }

  async deletePrefix(prefix: string): Promise<number> {
    assertSafeKey(prefix)
    let token: string | undefined
    let n = 0
    do {
      const page = await this.client.send(new ListObjectsV2Command({ Bucket: this.opts.bucket, Prefix: prefix, ContinuationToken: token }))
      const keys = (page.Contents ?? []).map((c) => ({ Key: c.Key! }))
      if (keys.length) {
        await this.client.send(new DeleteObjectsCommand({ Bucket: this.opts.bucket, Delete: { Objects: keys, Quiet: true } }))
        n += keys.length
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined
    } while (token)
    return n
  }

  async signedUrl(key: string, ttlSeconds = 600): Promise<string> {
    assertSafeKey(key)
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.opts.bucket, Key: key }), { expiresIn: ttlSeconds })
  }
}
