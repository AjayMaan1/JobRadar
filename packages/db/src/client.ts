import { PrismaClient } from '../generated/prisma/index.js'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

/**
 * Query logging is opt-in (PRISMA_LOG_QUERIES=1): Prisma's stdout query log includes bound parameters,
 * which for resume/profile tables means PII in log files (backlog C11-2).
 */
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.PRISMA_LOG_QUERIES === '1' ? ['query', 'error'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
