import { redirect } from 'next/navigation'
import { AuthError } from 'next-auth'
import { auth, signIn } from '@/lib/auth'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const session = await auth()
  if (session?.user) redirect('/')

  const { error } = await searchParams

  async function login(formData: FormData) {
    'use server'
    try {
      await signIn('credentials', {
        email: formData.get('email'),
        password: formData.get('password'),
        redirectTo: '/',
      })
    } catch (err) {
      // next-auth signals a successful redirect by throwing, so only a real
      // AuthError means the credentials were wrong.
      if (err instanceof AuthError) redirect('/login?error=1')
      throw err
    }
  }

  const input =
    'h-11 w-full rounded-lg border bg-surface px-3.5 text-sm outline-none placeholder:text-fg-muted focus:border-accent focus:ring-2 focus:ring-accent-bg'

  return (
    <div className="flex h-full bg-bg">
      {/* Brand panel: the design system's navy header, with its wave. */}
      <aside className="relative hidden w-[44%] overflow-hidden bg-navy-1000 p-12 text-navy-100 lg:flex lg:flex-col">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-orange-800 text-sm font-bold text-white">WA</span>
          <span className="text-sm font-semibold tracking-tight">
            WhatsApp <span className="font-normal text-navy-300">Platform</span>
          </span>
        </div>

        <div className="mt-auto mb-32 max-w-sm">
          <h2 className="text-h2 text-white">Semua percakapan, satu tempat.</h2>
          <p className="mt-4 text-sm leading-6 text-navy-300">
            Inbox bersama untuk banyak nomor, bot yang dirakit tanpa kode, dan broadcast yang menghormati
            kontak yang tidak ingin dihubungi.
          </p>
        </div>

        <svg
          aria-hidden
          viewBox="0 0 600 160"
          preserveAspectRatio="none"
          className="absolute inset-x-0 bottom-0 h-28 w-full"
        >
          <path d="M0 70 C 150 150, 360 150, 600 40 L600 160 L0 160 Z" className="fill-navy-900" />
          <path d="M0 110 C 180 170, 380 150, 600 95 L600 160 L0 160 Z" className="fill-orange-800" opacity="0.9" />
        </svg>
      </aside>

      <main className="flex flex-1 items-center justify-center p-6">
        <form action={login} className="w-full max-w-80 space-y-5">
          <div>
            <span className="mb-6 flex size-10 items-center justify-center rounded-xl bg-brand text-sm font-bold text-on-brand lg:hidden">
              WA
            </span>
            <h1 className="text-h3 text-fg">Masuk</h1>
            <p className="mt-1 text-sm text-fg-muted">Lanjutkan ke dashboard WhatsApp.</p>
          </div>

          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs text-fg">Email</span>
              <input name="email" type="email" required autoFocus placeholder="nama@perusahaan.com" className={input} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-fg">Kata sandi</span>
              <input name="password" type="password" required className={input} />
            </label>
          </div>

          {error && (
            <p className="rounded-lg bg-danger-bg px-3 py-2 text-xs text-danger" role="alert">
              ! Email atau kata sandi salah.
            </p>
          )}

          <button className="h-11 w-full rounded-lg bg-fg text-sm font-medium text-on-fg hover:opacity-90">Masuk</button>

          <p className="text-[11px] leading-5 text-fg-muted">
            Belum punya akun? Buat lewat terminal:
            <code className="mt-1 block rounded-md bg-muted px-2 py-1 font-mono text-[10px]">
              pnpm --filter @wa/web user:add
            </code>
          </p>
        </form>
      </main>
    </div>
  )
}
