'use client'

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useFormStatus } from 'react-dom'
import { changePassword, updateProfile, type ProfileState } from '@/lib/actions/profile'
import { hint, input, label } from '@/components/ui/styles'
import { cn } from '@/lib/utils'

export function NameForm({ name, email }: { name: string; email: string }) {
  const [state, action] = useActionState<ProfileState, FormData>(updateProfile, {})
  const router = useRouter()

  // The action's own re-render still sees the old session cookie, so the
  // header keeps the old name until a fresh request reads the new one.
  useEffect(() => {
    if (state.ok) router.refresh()
  }, [state, router])

  return (
    <form action={action} className="rounded-lg border bg-surface p-4">
      <label className="block">
        <span className={label}>Nama</span>
        <input name="name" defaultValue={name} required maxLength={80} autoComplete="name" className={input} />
        <span className={hint}>Tampil di kepala halaman dan di samping pesan yang kamu kirim dari Inbox.</span>
      </label>

      <label className="mt-4 block">
        <span className={label}>Email</span>
        <input value={email} disabled readOnly className={input} />
        <span className={hint}>Dipakai untuk masuk. Minta admin bila perlu diganti.</span>
      </label>

      <Footer state={state} idle="Simpan" busy="Menyimpan…" />
    </form>
  )
}

export function PasswordForm() {
  const [state, action] = useActionState<ProfileState, FormData>(changePassword, {})

  return (
    <form action={action} className="rounded-lg border bg-surface p-4">
      <label className="block">
        <span className={label}>Kata sandi saat ini</span>
        <input name="current" type="password" required autoComplete="current-password" className={input} />
      </label>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={label}>Kata sandi baru</span>
          <input name="next" type="password" required minLength={8} autoComplete="new-password" className={input} />
          <span className={hint}>Minimal 8 karakter.</span>
        </label>
        <label className="block">
          <span className={label}>Ulangi kata sandi baru</span>
          <input name="confirm" type="password" required minLength={8} autoComplete="new-password" className={input} />
        </label>
      </div>

      <Footer state={state} idle="Ganti kata sandi" busy="Mengganti…" />
    </form>
  )
}

function Footer({ state, idle, busy }: { state: ProfileState; idle: string; busy: string }) {
  const { pending } = useFormStatus()
  return (
    <div className="mt-4 flex items-center gap-3">
      <button
        disabled={pending}
        className="h-9 rounded-md bg-fg px-3 text-sm text-on-fg hover:opacity-90 disabled:opacity-50"
      >
        {pending ? busy : idle}
      </button>
      {!pending && (state.error || state.ok) && (
        <p role="status" className={cn('text-xs', state.error ? 'text-danger' : 'text-ok')}>
          {state.error ?? state.ok}
        </p>
      )}
    </div>
  )
}
