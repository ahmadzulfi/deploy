import { hash } from 'bcryptjs'
import { prisma, type Role } from '@wa/db'
import { loadEnvFile } from '@wa/core'

/**
 * Creates a dashboard login.
 *
 *   pnpm --filter @wa/web user:add --email you@co.com --name "Nama" --password "..." [--role ADMIN]
 */
function arg(flag: string) {
  const i = process.argv.indexOf(`--${flag}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  loadEnvFile()

  const email = arg('email')?.trim().toLowerCase()
  const name = arg('name')
  const password = arg('password')
  const role = (arg('role') ?? 'OWNER') as Role

  if (!email || !name || !password) {
    console.error('Usage: pnpm --filter @wa/web user:add --email <email> --name <nama> --password <sandi> [--role OWNER|ADMIN|SUPERVISOR|AGENT|VIEWER]')
    process.exitCode = 1
    return
  }
  if (password.length < 8) {
    console.error('Kata sandi minimal 8 karakter.')
    process.exitCode = 1
    return
  }

  const org = (await prisma.organization.findFirst()) ?? (await prisma.organization.create({ data: { name: 'Internal' } }))

  const user = await prisma.user.upsert({
    where: { email },
    create: { orgId: org.id, email, name, role, passwordHash: await hash(password, 10) },
    update: { name, role, passwordHash: await hash(password, 10), active: true },
  })

  console.log(`User siap: ${user.email} (${user.role})`)
}

// Wrapped in an IIFE: this app is CJS (Next does not set type: module), so
// top-level await will not compile here. Disconnect still runs before exit.
void (async () => {
  try {
    await main()
  } catch (err) {
    console.error()
    console.error('Failed:', err instanceof Error ? err.message : err)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
})()
