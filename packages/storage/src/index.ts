import { LocalFsStore } from './local.js'
import { S3Store } from './s3.js'
import type { ObjectStore } from './types.js'

export type { ObjectStore, ObjectMeta, PutOptions } from './types.js'
export { assertSafeKey } from './types.js'
export { LocalFsStore, verifySignedQuery } from './local.js'
export { S3Store } from './s3.js'

/**
 * STORAGE_DRIVER = local (default) | s3.
 * local: STORAGE_LOCAL_ROOT (default ./data/objects), STORAGE_SIGNING_SECRET (required, ≥16 chars), STORAGE_ENCRYPTION_KEY (optional, AES-256-GCM at rest)
 * s3:    S3_BUCKET, S3_REGION, S3_ENDPOINT (MinIO), S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_SSE
 */
export function createObjectStore(env: NodeJS.ProcessEnv = process.env): ObjectStore {
  const driver = (env.STORAGE_DRIVER ?? 'local').toLowerCase()
  if (driver === 's3') {
    return new S3Store({
      bucket: env.S3_BUCKET ?? '',
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      sse: (env.S3_SSE as 'AES256' | 'aws:kms' | undefined) ?? 'AES256',
    })
  }
  const secret = env.STORAGE_SIGNING_SECRET
  if (!secret) throw new Error('STORAGE_SIGNING_SECRET is required for the local storage driver (any random string ≥ 16 chars)')
  return new LocalFsStore({ root: env.STORAGE_LOCAL_ROOT ?? './data/objects', signingSecret: secret, publicPath: env.STORAGE_PUBLIC_PATH, encryptionKey: env.STORAGE_ENCRYPTION_KEY || null })
}
