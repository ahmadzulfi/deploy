import Link from 'next/link'
import type { DashboardData } from '@/lib/dashboard'
import { CAMPAIGN_STATUS } from '@/lib/campaigns'
import { DashboardShell } from '@/components/dashboard/dashboard-shell'
import { Sparkline, TrendChart } from '@/components/dashboard/trend-chart'
import { StatusBars } from '@/components/dashboard/status-bars'
import { cn, initials, shortTime } from '@/lib/utils'

/**
 * The home page's markup, separate from its queries so it renders from any
 * data of the right shape.
 */
const num = new Intl.NumberFormat('id-ID')
const compact = new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 })
const pct = new Intl.NumberFormat('id-ID', { style: 'percent', maximumFractionDigits: 1 })

const QUALITY: Record<string, { label: string; tone: string; icon: string }> = {
  GREEN: { label: 'baik', tone: 'bg-ok-bg text-ok', icon: '●' },
  YELLOW: { label: 'waspada', tone: 'bg-warn-bg text-warn', icon: '▲' },
  RED: { label: 'buruk', tone: 'bg-danger-bg text-danger', icon: '!' },
  UNKNOWN: { label: 'belum ada', tone: 'bg-muted text-fg-muted', icon: '–' },
}

export function greeting(tz: string) {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(new Date()))
  if (h < 11) return 'Selamat pagi'
  if (h < 15) return 'Selamat siang'
  if (h < 18) return 'Selamat sore'
  return 'Selamat malam'
}

/** What a message is, in a few words, for a one-line preview. */
function preview(type: string, payload: unknown) {
  const p = (payload ?? {}) as Record<string, unknown>
  switch (type) {
    case 'text':
      return String(p.body ?? '')
    case 'interactive':
    case 'button':
      return `menekan “${String(p.title ?? p.text ?? p.replyId ?? '')}”`
    case 'image':
      return `📷 ${String(p.caption ?? 'Gambar')}`
    case 'video':
      return `🎬 ${String(p.caption ?? 'Video')}`
    case 'audio':
      return '🎤 Pesan suara'
    case 'document':
      return `📄 ${String(p.filename ?? 'Dokumen')}`
    case 'sticker':
      return 'Stiker'
    case 'location':
      return `📍 ${String(p.name ?? 'Lokasi')}`
    case 'form_reply':
      return '📝 Mengisi formulir'
    default:
      return `[${type}]`
  }
}


type Contact = { name: string | null; waId: string }

export interface DashboardViewProps {
  userName: string
  greeting: string
  range: number
  ranges: readonly number[]
  channelId: string | null
  channels: { id: string; name: string }[]
  now: Date
  d: DashboardData
  unreadList: { id: string; unreadCount: number; lastMessageAt: Date | null; contact: Contact; channel: { name: string } }[]
  closingSoon: { id: string; windowExpiresAt: Date | null; contact: Contact }[]
  recentInbound: { id: string; conversationId: string; type: string; payload: unknown; createdAt: Date; conversation: { contact: Contact } }[]
  campaigns: { id: string; name: string; status: string; sentCount: number; failedCount: number; skippedCount: number; totalCount: number }[]
}

export function DashboardView({
  userName,
  greeting: hello,
  range,
  ranges,
  channelId,
  channels,
  now,
  d,
  unreadList,
  closingSoon,
  recentInbound,
  campaigns,
}: DashboardViewProps) {
  const period = `${range} hari sebelumnya`

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl p-6">
        <div className="mb-4">
          <h1 className="text-h4 text-fg">
            {hello}, {userName.split(' ')[0]}
          </h1>
          <p className="mt-0.5 text-xs text-fg-muted">Ringkasan percakapan WhatsApp di semua nomor organisasi ini.</p>
        </div>

        <DashboardShell range={range} ranges={ranges} channelId={channelId} channels={channels}>
          {/* Hero: the one number an agent acts on right now. */}
          <section className="mb-4 grid gap-3 lg:grid-cols-[1.3fr_1fr_1fr]">
            <Link
              href="/inbox"
              className="group rounded-xl border bg-surface p-5 transition-colors hover:border-accent"
            >
              <div className="text-xs text-fg-muted">Percakapan belum dibaca</div>
              <div className="mt-1 text-h1 tracking-tight text-fg">{num.format(d.now.unread)}</div>
              <div className="mt-2 text-[11px] text-accent group-hover:underline">Buka inbox →</div>
            </Link>
            <NowTile
              label="Window 24 jam terbuka"
              value={d.now.openWindows}
              hint="Bisa dibalas dengan pesan biasa, tanpa template."
            />
            <NowTile label="Sedang ditangani agen" value={d.now.withAgent} hint="Bot berhenti menjawab di percakapan ini." />
          </section>

          {/* KPI row for the chosen range, each against the period before it. */}
          <section className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Pesan masuk"
              value={compact.format(d.totals.inbound)}
              delta={change(d.totals.inbound, d.previous.inbound)}
              period={period}
              trend={d.inbound}
            />
            <StatTile
              label="Pesan keluar"
              value={compact.format(d.totals.outbound)}
              delta={change(d.totals.outbound, d.previous.outbound)}
              period={period}
              trend={d.outbound}
            />
            <StatTile
              label="Percakapan baru"
              value={compact.format(d.totals.newConversations)}
              delta={change(d.totals.newConversations, d.previous.newConversations)}
              upIsGood
              period={period}
              trend={d.newConversations}
            />
            <StatTile
              label="Pesan keluar sampai"
              value={d.totals.deliveryRate === null ? '—' : pct.format(d.totals.deliveryRate)}
              delta={
                d.totals.deliveryRate === null || d.previous.deliveryRate === null
                  ? null
                  : { text: `${((d.totals.deliveryRate - d.previous.deliveryRate) * 100).toFixed(1).replace('.', ',')} poin`, sign: Math.sign(d.totals.deliveryRate - d.previous.deliveryRate) }
              }
              upIsGood
              period={period}
            />
          </section>

          <section className="mb-4 grid gap-3 lg:grid-cols-[2fr_1fr]">
            <TrendChart
              title={`Pesan per hari, ${range} hari terakhir`}
              days={d.days}
              series={[
                { key: 'in', label: 'Masuk', color: 'var(--color-series-1)', values: d.inbound },
                { key: 'out', label: 'Keluar', color: 'var(--color-series-2)', values: d.outbound },
              ]}
            />
            <StatusBars
              title="Status pesan keluar"
              rows={[
                { key: 'read', label: 'Dibaca', value: d.outboundStatus.READ },
                { key: 'delivered', label: 'Sampai', value: d.outboundStatus.DELIVERED },
                { key: 'sent', label: 'Terkirim', value: d.outboundStatus.SENT },
                { key: 'queued', label: 'Antre', value: d.outboundStatus.QUEUED },
                { key: 'failed', label: 'Gagal', value: d.outboundStatus.FAILED, critical: true },
              ]}
              note="Status terakhir tiap pesan. Dibaca hanya tercatat kalau kontak tidak mematikan centang biru."
            />
          </section>

          <section className="mb-4 grid gap-3 lg:grid-cols-2">
            <Panel title="Perlu dibalas" empty="Tidak ada pesan yang belum dibaca." count={unreadList.length}>
              {unreadList.map((c) => (
                <Row key={c.id} href={`/inbox/${c.id}`} name={c.contact.name} waId={c.contact.waId}>
                  <span className="text-[11px] text-fg-muted">{c.channel.name}</span>
                  <span className="rounded-full bg-accent px-1.5 text-[10px] font-medium text-on-accent">{c.unreadCount}</span>
                  <span className="w-12 text-right text-[11px] text-fg-muted">{shortTime(c.lastMessageAt)}</span>
                </Row>
              ))}
            </Panel>

            <Panel
              title="Window hampir tutup"
              empty="Tidak ada window yang tutup dalam 3 jam ke depan."
              count={closingSoon.length}
              hint="Setelah tutup, hanya template yang bisa dikirim."
            >
              {closingSoon.map((c) => {
                const mins = Math.max(0, Math.round((c.windowExpiresAt!.getTime() - now.getTime()) / 60_000))
                return (
                  <Row key={c.id} href={`/inbox/${c.id}`} name={c.contact.name} waId={c.contact.waId}>
                    <span
                      className={cn(
                        'rounded px-1.5 py-px text-[10px]',
                        mins < 60 ? 'bg-danger-bg text-danger' : 'bg-warn-bg text-warn',
                      )}
                    >
                      ⏱ {mins < 60 ? `${mins} mnt` : `${Math.floor(mins / 60)} j ${mins % 60} mnt`}
                    </span>
                  </Row>
                )
              })}
            </Panel>
          </section>

          <section className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
            <Panel title="Pesan masuk terbaru" empty="Belum ada pesan masuk." count={recentInbound.length}>
              {recentInbound.map((m) => (
                <Row
                  key={m.id}
                  href={`/inbox/${m.conversationId}`}
                  name={m.conversation.contact.name}
                  waId={m.conversation.contact.waId}
                  sub={preview(m.type, m.payload)}
                >
                  <span className="w-12 text-right text-[11px] text-fg-muted">{shortTime(m.createdAt)}</span>
                </Row>
              ))}
            </Panel>

            <div className="space-y-3">
              <Panel title="Nomor" count={d.channels.length} empty="Belum ada nomor." href="/channels">
                {d.channels.map((c) => {
                  const q = QUALITY[c.qualityRating] ?? QUALITY.UNKNOWN!
                  return (
                    <div key={c.id} className="flex items-center gap-3 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] text-fg">{c.name}</div>
                        <div className="truncate font-mono text-[10px] text-fg-muted">{c.displayPhone ?? '—'}</div>
                      </div>
                      <span className="text-[11px] text-fg-muted tabular-nums" title={`${range} hari terakhir`}>
                        ↓{num.format(c.inbound)} ↑{num.format(c.outbound)}
                      </span>
                      {c.sendingPaused ? (
                        <span className="rounded bg-danger-bg px-1.5 py-px text-[10px] text-danger">! dijeda</span>
                      ) : (
                        <span className={cn('rounded px-1.5 py-px text-[10px]', q.tone)} title="Quality rating dari Meta">
                          {q.icon} {q.label}
                        </span>
                      )}
                    </div>
                  )
                })}
              </Panel>

              <Panel title="Broadcast terbaru" count={campaigns.length} empty="Belum ada broadcast yang berjalan." href="/broadcast">
                {campaigns.map((c) => {
                  const st = CAMPAIGN_STATUS[c.status] ?? CAMPAIGN_STATUS.DRAFT!
                  const done = c.sentCount + c.failedCount + c.skippedCount
                  const ratio = c.totalCount ? done / c.totalCount : 0
                  return (
                    <Link key={c.id} href={`/broadcast/${c.id}`} className="block px-3 py-2.5 hover:bg-muted">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13px] text-fg">{c.name}</span>
                        <span className={cn('shrink-0 rounded px-1.5 py-px text-[10px]', st.tone)}>{st.label}</span>
                      </div>
                      {/* Meter: the unfilled track is a lighter step of the same hue. */}
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-accent-bg">
                        <div className="h-full rounded-full bg-[var(--color-series-1)]" style={{ width: `${ratio * 100}%` }} />
                      </div>
                      <div className="mt-1 text-[10px] text-fg-muted tabular-nums">
                        {num.format(c.sentCount)} terkirim · {num.format(c.failedCount)} gagal · {num.format(c.totalCount)} total
                      </div>
                    </Link>
                  )
                })}
              </Panel>
            </div>
          </section>
        </DashboardShell>
      </div>
    </div>
  )
}

function change(now: number, before: number): { text: string; sign: number } | null {
  if (before === 0) return now === 0 ? { text: 'sama', sign: 0 } : null
  const r = (now - before) / before
  return { text: pct.format(Math.abs(r)), sign: Math.sign(r) }
}

function StatTile({
  label,
  value,
  delta,
  period,
  trend,
  upIsGood,
}: {
  label: string
  value: string
  delta: { text: string; sign: number } | null
  period: string
  trend?: number[]
  /** Colour the delta by whether the change is good; otherwise it stays neutral ink. */
  upIsGood?: boolean
}) {
  const tone =
    !upIsGood || !delta || delta.sign === 0 ? 'text-fg-muted' : delta.sign > 0 ? 'text-ok' : 'text-danger'
  return (
    <div className="rounded-xl border bg-surface p-4">
      <div className="text-xs text-fg-muted">{label}</div>
      <div className="mt-1 flex items-end justify-between gap-2">
        <div className="text-h3 tracking-tight text-fg">{value}</div>
        {trend && trend.length > 1 && <Sparkline values={trend} />}
      </div>
      <div className={cn('mt-1 text-[11px]', tone)}>
        {delta ? (
          <>
            {delta.sign > 0 ? '▲' : delta.sign < 0 ? '▼' : '='} {delta.text}{' '}
            <span className="text-fg-muted">vs {period}</span>
          </>
        ) : (
          <span className="text-fg-muted">belum ada pembanding</span>
        )}
      </div>
    </div>
  )
}

function NowTile({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="rounded-xl border bg-surface p-5">
      <div className="text-xs text-fg-muted">{label}</div>
      <div className="mt-1 text-h3 tracking-tight text-fg">{num.format(value)}</div>
      <div className="mt-2 text-[11px] text-fg-muted">{hint}</div>
    </div>
  )
}

function Panel({
  title,
  count,
  empty,
  hint,
  href,
  children,
}: {
  title: string
  count: number
  empty: string
  hint?: string
  href?: string
  children: React.ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-xl border bg-surface">
      <div className="flex items-baseline justify-between border-b px-3 py-2.5">
        <h2 className="text-sm text-fg">{title}</h2>
        {href ? (
          <Link href={href} className="text-[11px] text-fg-muted hover:text-fg">
            Lihat semua →
          </Link>
        ) : (
          hint && <span className="text-[11px] text-fg-muted">{hint}</span>
        )}
      </div>
      {count === 0 ? <p className="px-3 py-6 text-center text-xs text-fg-muted">{empty}</p> : <div className="divide-y">{children}</div>}
    </section>
  )
}

function Row({
  href,
  name,
  waId,
  sub,
  children,
}: {
  href: string
  name: string | null
  waId: string
  sub?: string
  children?: React.ReactNode
}) {
  return (
    <Link href={href} className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] text-fg-muted">
        {initials(name, waId)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-fg">{name || `+${waId}`}</span>
        {sub && <span className="block truncate text-[11px] text-fg-muted">{sub}</span>}
      </span>
      {children}
    </Link>
  )
}
