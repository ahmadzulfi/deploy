import { redirect } from 'next/navigation'
import { AuthError } from 'next-auth'
import { auth, signIn } from '@/lib/auth'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const session = await auth()
  if (session?.user) redirect('/inbox')

  const { error } = await searchParams

  async function login(formData: FormData) {
    'use server'
    try {
      await signIn('credentials', {
        email: formData.get('email'),
        password: formData.get('password'),
        redirectTo: '/inbox',
      })
    } catch (err) {
      // next-auth signals a successful redirect by throwing, so only a real
      // AuthError means the credentials were wrong.
      if (err instanceof AuthError) redirect('/login?error=1')
      throw err
    }
  }

  return (
    <div className="flex h-full items-center justify-center p-6">
      <form action={login} className="w-full max-w-72 space-y-4">
        <div>
          <h1 className="text-base text-fg">Masuk</h1>
          <p className="mt-1 text-xs text-fg-muted">Platform WhatsApp internal</p>
        </div>

        <div className="space-y-2">
          <input
            name="email"
            type="email"
            required
            autoFocus
            placeholder="nama@perusahaan.com"
            className="h-9 w-full rounded-md border bg-surface px-3 text-sm outline-none placeholder:text-fg-muted focus:border-accent"
          />
          <input
            name="password"
            type="password"
            required
            placeholder="Kata sandi"
            className="h-9 w-full rounded-md border bg-surface px-3 text-sm outline-none placeholder:text-fg-muted focus:border-accent"
          />
        </div>

        {error && <p className="text-xs text-danger">Email atau kata sandi salah.</p>}

        <button className="h-9 w-full rounded-md bg-fg text-sm text-white hover:opacity-90">
          Masuk
        </button>

        <p className="text-[11px] leading-5 text-fg-muted">
          Belum punya akun? Buat lewat terminal:
          <code className="mt-1 block rounded bg-muted px-2 py-1 font-mono text-[10px]">
            pnpm --filter @wa/web user:add
          </code>
        </p>
      </form>
    </div>
  )
}
