export interface PutOptions {
  contentType?: string
  /** Suggested download filename (Content-Disposition). */
  filename?: string
}

export interface ObjectMeta {
  key: string
  size: number
  contentType: string | null
  filename?: string | null
}

/**
 * Object storage abstraction (HLD C3-5). Keys are opaque slash-separated paths; callers scope them per user
 * (`users/<userId>/resumes/<resumeId>/original.pdf`). Signed URLs are short-lived and the only way the
 * browser ever touches a file.
 */
export interface ObjectStore {
  readonly driver: 'local' | 's3'
  put(key: string, body: Buffer, opts?: PutOptions): Promise<ObjectMeta>
  get(key: string): Promise<Buffer>
  head(key: string): Promise<ObjectMeta | null>
  delete(key: string): Promise<void>
  /** Delete every object under a prefix (user erasure). Returns count. */
  deletePrefix(prefix: string): Promise<number>
  /** URL a browser can GET for `ttlSeconds`. For the local driver this is a signed app route. */
  signedUrl(key: string, ttlSeconds?: number): Promise<string>
  /** Keys under a prefix (orphan sweeps, exports). Paged internally; bounded by `limit`. */
  list(prefix: string, limit?: number): Promise<string[]>
}

export function assertSafeKey(key: string): void {
  if (!key || key.startsWith('/') || key.includes('..') || key.includes('\\') || /[\0\n\r]/.test(key)) {
    throw new Error(`Unsafe object key: ${JSON.stringify(key)}`)
  }
}
