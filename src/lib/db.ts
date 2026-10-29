import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient(
    process.env.NODE_ENV !== 'production' ? { log: ['query'] } : undefined,
  )

// Always assign to globalForPrisma so that the singleton is preserved across
// hot-reloads in dev AND across Vercel/Edge cold-start module re-evaluations
// in production. Without this, a second PrismaClient instance can be created
// before the first one has connected, causing "table does not exist" 500 errors.
globalForPrisma.prisma = db
