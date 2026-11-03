import 'dotenv/config'
import { randomBytes, scryptSync } from 'node:crypto'
import { prisma } from '@jobradar/db'

/**
 * Create or reset a login: pnpm user:create <email> <password> [admin|user]
 * (Same scrypt format as apps/web/lib/auth.ts.)
 */
function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password.normalize('NFKC'), salt, 64, { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 })
  return `scrypt$${2 ** 15}$${salt.toString('base64url')}$${hash.toString('base64url')}`
}

async function main() {
  const [email, password, role = 'admin'] = process.argv.slice(2)
  if (!email || !password) { console.error('usage: pnpm user:create <email> <password> [admin|user]'); process.exit(1) }
  if (password.length < 10) { console.error('password must be at least 10 characters'); process.exit(1) }
  const user = await prisma.user.upsert({
    where: { email: email.toLowerCase() },
    update: { passwordHash: hashPassword(password), role },
    create: { email: email.toLowerCase(), passwordHash: hashPassword(password), role },
  })
  await prisma.session.deleteMany({ where: { userId: user.id } }) // password change logs out everywhere
  console.log(`user ${user.email} (${user.role}) ready`)
  await prisma.$disconnect()
}
main().catch((err) => { console.error(err); process.exit(1) })
