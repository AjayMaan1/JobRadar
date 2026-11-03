/** Sandbox shim for @jobradar/db: exports the in-memory Prisma double as the `prisma` singleton. */
import { createFakePrisma } from '../../fake-prisma.js'
export const prisma: any = createFakePrisma()
export const Prisma: any = { sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }), raw: (s: string) => ({ strings: [s], values: [] }), join: (v: unknown[]) => ({ strings: [], values: v }), TransactionIsolationLevel: { Serializable: 'Serializable' } }
export type PrismaClient = any
