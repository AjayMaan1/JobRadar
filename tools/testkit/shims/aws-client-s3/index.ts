/** Sandbox shim: S3 driver is not exercised offline; commands are inert. */
export class S3Client { constructor(public cfg: unknown) {} async send(_cmd: unknown): Promise<never> { throw new Error('S3 not available in the sandbox') } }
const cmd = class { constructor(public input: unknown) {} }
export class PutObjectCommand extends cmd {}
export class GetObjectCommand extends cmd {}
export class HeadObjectCommand extends cmd {}
export class DeleteObjectCommand extends cmd {}
export class DeleteObjectsCommand extends cmd {}
export class ListObjectsV2Command extends cmd {}
