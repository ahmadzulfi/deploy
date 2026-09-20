import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth, signOut } from '@/lib/auth'
import { NavRail } from '@/components/nav-rail'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) redirect('/login')

  return (
    <div className="flex h-full">
      <NavRail />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between border-b bg-surface px-4">
          <Link href="/inbox" className="text-sm text-fg">
            WhatsApp Platform
          </Link>
          <div className="flex items-center gap-3">
            <span className="text-xs text-fg-muted">
              {session.user.name} · {session.user.role.toLowerCase()}
            </span>
            <form
              action={async () => {
                'use server'
                await signOut({ redirectTo: '/login' })
              }}
            >
              <button className="text-xs text-fg-muted hover:text-fg">Keluar</button>
            </form>
          </div>
        </header>
        <main className="min-h-0 flex-1">{children}</main>
      </div>
    </div>
  )
}
