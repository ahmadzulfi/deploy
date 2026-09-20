import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { compare } from 'bcryptjs'
import { prisma, type Role } from '@wa/db'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      email: string
      name: string
      role: Role
      orgId: string
    }
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const email = typeof raw.email === 'string' ? raw.email.trim().toLowerCase() : ''
        const password = typeof raw.password === 'string' ? raw.password : ''
        if (!email || !password) return null

        const user = await prisma.user.findUnique({ where: { email } })

        // A user row with no passwordHash exists but cannot sign in. Still run
        // a compare against a dummy hash so the response time does not reveal
        // which emails are registered.
        const hash = user?.passwordHash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin'
        const ok = await compare(password, hash)

        if (!user || !user.passwordHash || !user.active || !ok) return null

        return { id: user.id, email: user.email, name: user.name, role: user.role, orgId: user.orgId }
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = (user as { role: Role }).role
        token.orgId = (user as { orgId: string }).orgId
      }
      return token
    },
    session({ session, token }) {
      session.user.id = token.sub!
      session.user.role = token.role as Role
      session.user.orgId = token.orgId as string
      return session
    },
  },
})

/** Throws if not signed in. Use at the top of every server action and page. */
export async function requireUser() {
  const session = await auth()
  if (!session?.user) throw new Error('unauthorized')
  return session.user
}

const RANK: Record<Role, number> = { VIEWER: 0, AGENT: 1, SUPERVISOR: 2, ADMIN: 3, OWNER: 4 }

export async function requireRole(min: Role) {
  const user = await requireUser()
  if (RANK[user.role] < RANK[min]) throw new Error(`requires ${min} or above`)
  return user
}
