'use client'

import { useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { deleteCampaign, pauseCampaign, resumeCampaign, startCampaign } from '@/lib/actions/campaigns'

const button = 'h-9 rounded-md px-3 text-sm disabled:opacity-50'

export function CampaignActions({
  id,
  status,
  canManage,
  recipients,
  scheduled,
}: {
  id: string
  status: string
  canManage: boolean
  /** Shown in the start confirmation, so nobody starts a send to the wrong size of list. */
  recipients: number | null
  scheduled: string | null
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const live = status === 'RUNNING' || status === 'SCHEDULED'

  // Progress comes from the worker; re-read the page while it is moving.
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => router.refresh(), 5_000)
    return () => clearInterval(t)
  }, [live, router])

  if (!canManage) return null

  const run = (fn: (id: string) => Promise<void>) => start(() => void fn(id))

  return (
    <div className="flex flex-wrap gap-2">
      {status === 'DRAFT' && (
        <>
          <button
            disabled={pending}
            onClick={() => {
              const who = recipients === null ? 'semua penerima' : `${recipients} kontak`
              const when = scheduled ? `pada ${scheduled}` : 'sekarang'
              if (confirm(`Kirim broadcast ini ke ${who} ${when}? Pesan yang sudah terkirim tidak bisa ditarik.`)) {
                run(startCampaign)
              }
            }}
            className={`${button} bg-brand font-medium text-on-brand hover:opacity-90`}
          >
            {scheduled ? 'Jadwalkan' : 'Mulai kirim'}
          </button>
          <button
            disabled={pending}
            onClick={() => confirm('Hapus draf ini?') && run(deleteCampaign)}
            className={`${button} border bg-surface text-fg-muted hover:text-danger`}
          >
            Hapus draf
          </button>
        </>
      )}
      {live && (
        <button disabled={pending} onClick={() => run(pauseCampaign)} className={`${button} border bg-surface text-fg hover:bg-muted`}>
          Jeda
        </button>
      )}
      {status === 'PAUSED' && (
        <button disabled={pending} onClick={() => run(resumeCampaign)} className={`${button} bg-fg text-on-fg hover:opacity-90`}>
          Lanjutkan
        </button>
      )}
    </div>
  )
}
