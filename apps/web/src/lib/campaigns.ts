export const CAMPAIGN_STATUS: Record<string, { label: string; tone: string }> = {
  DRAFT: { label: 'draf', tone: 'bg-muted text-fg-muted' },
  SCHEDULED: { label: 'terjadwal', tone: 'bg-accent-bg text-accent' },
  RUNNING: { label: 'berjalan', tone: 'bg-warn-bg text-warn' },
  PAUSED: { label: 'dijeda', tone: 'bg-muted text-fg' },
  COMPLETED: { label: 'selesai', tone: 'bg-ok-bg text-ok' },
  FAILED: { label: 'gagal', tone: 'bg-danger-bg text-danger' },
}

export const RECIPIENT_STATUS: Record<string, { label: string; tone: string }> = {
  PENDING: { label: 'menunggu', tone: 'text-fg-muted' },
  SENT: { label: 'terkirim', tone: 'text-fg' },
  DELIVERED: { label: 'sampai', tone: 'text-ok' },
  READ: { label: 'dibaca', tone: 'text-ok' },
  FAILED: { label: 'gagal', tone: 'text-danger' },
  SKIPPED: { label: 'dilewati', tone: 'text-fg-muted' },
}

export const formatStamp = (d: Date | null) =>
  d ? d.toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'
