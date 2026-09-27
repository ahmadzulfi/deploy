import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth, signOut } from '@/lib/auth'
import { NavRail } from '@/components/nav-rail'
import { ThemeToggle } from '@/components/theme-toggle'
import { initials } from '@/lib/utils'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) redirect('/login')

  return (
    <div className="flex h-full">
      <NavRail />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b bg-surface px-5">
          <Link href="/" className="text-sm font-semibold tracking-tight text-fg">
            WhatsApp <span className="font-normal text-fg-muted">Platform</span>
          </Link>
          <div className="flex items-center gap-4">
            <ThemeToggle />
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-full bg-accent-bg text-[11px] font-medium text-fg">
                {initials(session.user.name, session.user.email)}
              </span>
              <span className="hidden text-xs leading-tight sm:block">
                <span className="block text-fg">{session.user.name}</span>
                <span className="block text-[10px] text-fg-muted">{session.user.role.toLowerCase()}</span>
              </span>
            </div>
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
