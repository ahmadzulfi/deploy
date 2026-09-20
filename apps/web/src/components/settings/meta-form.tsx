'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { saveMetaSettings, type SettingsState } from '@/lib/actions/settings'
import { cn } from '@/lib/utils'

const input =
  'h-9 w-full rounded-md border bg-surface px-3 text-sm outline-none placeholder:text-fg-muted focus:border-accent disabled:opacity-60'

export function MetaSettingsForm({
  canManage,
  appSecretSource,
  verifyToken,
  graphVersion,
}: {
  canManage: boolean
  appSecretSource: 'db' | 'env' | 'missing'
  verifyToken: string
  graphVersion: string
}) {
  const [state, action] = useActionState<SettingsState, FormData>(saveMetaSettings, {})
  const [copied, setCopied] = useState(false)

  return (
    <form action={action} className="rounded-lg border bg-surface p-4">
      <label className="block">
        <span className="text-xs text-fg">App secret</span>
        <input
          name="appSecret"
          type="password"
          disabled={!canManage}
          placeholder={appSecretSource === 'missing' ? 'Belum diatur' : 'Biarkan kosong jika tidak diubah'}
          className={cn(input, 'mt-1 font-mono')}
        />
        <span className="mt-1 flex items-center gap-1.5 text-[11px]">
          <SourceBadge source={appSecretSource} />
          <span className="text-fg-muted">
            {appSecretSource === 'db'
              ? 'Tersimpan terenkripsi. Isi hanya bila ingin mengganti.'
              : appSecretSource === 'env'
                ? 'Masih dibaca dari .env. Mengisi di sini akan menggantikannya.'
                : 'Webhook akan menolak semua pesan sampai ini diisi.'}
          </span>
        </span>
      </label>

      <label className="mt-4 block">
        <span className="text-xs text-fg">Verify token</span>
        <input
          name="verifyToken"
          defaultValue={verifyToken}
          disabled={!canManage}
          className={cn(input, 'mt-1 font-mono')}
        />
        <span className="mt-1 block text-[11px] text-fg-muted">
          Nilai yang sama harus dipaste ke kolom Verify token di Meta App Dashboard.
        </span>
      </label>

      <div className="mt-4 rounded-md bg-muted p-3">
        <div className="text-[11px] text-fg-muted">Callback URL untuk Meta</div>
        <div className="mt-1 flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg">
            https://&lt;tunnel-kamu&gt;/webhooks/whatsapp
          </code>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText('/webhooks/whatsapp')
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
            className="shrink-0 text-[11px] text-accent hover:opacity-80"
          >
            {copied ? 'Disalin' : 'Salin path'}
          </button>
        </div>
        <p className="mt-1 text-[10px] text-fg-muted">
          Graph API {graphVersion}. URL tunnel gratis berubah tiap dijalankan ulang, jadi
          callback di Meta perlu diperbarui setiap kali.
        </p>
      </div>

      {state.error && <p className="mt-3 text-xs text-danger">{state.error}</p>}
      {state.ok && <p className="mt-3 text-xs text-ok">{state.ok}</p>}

      {canManage ? (
        <Submit />
      ) : (
        <p className="mt-4 text-xs text-fg-muted">Hanya admin yang dapat mengubah ini.</p>
      )}
    </form>
  )
}

function SourceBadge({ source }: { source: 'db' | 'env' | 'missing' }) {
  const map = {
    db: ['tersimpan', 'bg-ok-bg text-ok'],
    env: ['dari .env', 'bg-warn-bg text-warn'],
    missing: ['belum diatur', 'bg-danger-bg text-danger'],
  } as const
  const [label, tone] = map[source]
  return <span className={cn('rounded px-1.5 py-px text-[10px]', tone)}>{label}</span>
}

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button
      disabled={pending}
      className="mt-4 h-9 rounded-md bg-fg px-3 text-sm text-white hover:opacity-90 disabled:opacity-50"
    >
      {pending ? 'Menyimpan…' : 'Simpan'}
    </button>
  )
}
