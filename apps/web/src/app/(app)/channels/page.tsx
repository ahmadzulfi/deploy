import Link from "next/link";
import { prisma } from "@wa/db";
import { requireUser } from "@/lib/auth";
import { Connections } from "@/components/settings/connections";
import { ChannelActions } from "@/components/channel-actions";
import { cn, shortTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

const QUALITY_TONE: Record<string, string> = {
  GREEN: "bg-ok-bg text-ok",
  YELLOW: "bg-warn-bg text-warn",
  RED: "bg-danger-bg text-danger",
  UNKNOWN: "bg-muted text-fg-muted",
};

export default async function ChannelsPage() {
  const user = await requireUser();

  const [channels, connections, templates] = await Promise.all([
    prisma.channel.findMany({
      where: { orgId: user.orgId },
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { conversations: true } } },
    }),
    prisma.wabaConnection.findMany({
      where: { orgId: user.orgId },
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { channels: true } } },
    }),
    prisma.template.groupBy({
      by: ["metaStatus"],
      where: { channel: { orgId: user.orgId } },
      _count: true,
      _max: { syncedAt: true },
    }),
  ]);

  const templateTotal = templates.reduce((n, t) => n + t._count, 0);
  const countOf = (s: string) =>
    templates.find((t) => t.metaStatus === s)?._count ?? 0;
  const templateApproved = countOf("APPROVED");
  const templatePending = countOf("PENDING");
  const lastSync = templates.reduce<Date | null>(
    (max, t) =>
      t._max.syncedAt && (!max || t._max.syncedAt > max) ? t._max.syncedAt : max,
    null,
  );

  // The webhook receiver lives on its own port, so the callback URL cannot be
  // derived from this request. Shown as a template the user completes with
  // their tunnel or domain.
  const origin = process.env.PUBLIC_WEBHOOK_ORIGIN ?? "https://<tunnel-kamu>";

  const canManage = user.role === "OWNER" || user.role === "ADMIN";

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl p-6">
        <div className="mb-1 flex items-baseline justify-between">
          <h1 className="text-h5 text-fg">Nomor WhatsApp</h1>
          <span className="text-xs text-fg-muted">
            {channels.length} terdaftar
          </span>
        </div>
        <p className="mb-5 text-xs text-fg-muted">
          Nomor ditarik otomatis dari WABA yang terhubung di bawah. Tiap nomor
          punya kuota dan quality rating sendiri.
        </p>

        <div className="overflow-hidden rounded-lg border bg-surface">
          {channels.length === 0 && (
            <p className="p-8 text-center text-sm text-fg-muted">
              Belum ada nomor. Hubungkan WABA di bawah untuk menarik nomornya.
            </p>
          )}

          {channels.map((c, i) => (
            <div
              key={c.id}
              className={cn("flex items-center gap-4 p-4", i > 0 && "border-t")}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm text-fg">{c.name}</span>
                  {c.sendingPaused && (
                    <span
                      className="rounded bg-danger-bg px-1.5 py-px text-[10px] text-danger"
                      title={c.pausedReason ?? undefined}
                    >
                      pengiriman dijeda
                    </span>
                  )}
                </div>
                <div className="mt-0.5 truncate font-mono text-xs text-fg-muted">
                  {c.displayPhone ?? "—"}
                </div>
              </div>

              <div className="hidden w-28 shrink-0 sm:block">
                <div className="text-[10px] text-fg-muted">Kualitas</div>
                <span
                  className={cn(
                    "mt-0.5 inline-flex rounded px-1.5 py-px text-[10px]",
                    QUALITY_TONE[c.qualityRating] ?? QUALITY_TONE.UNKNOWN,
                  )}
                >
                  {c.qualityRating.toLowerCase()}
                </span>
              </div>

              <div className="hidden w-24 shrink-0 sm:block">
                <div className="text-[10px] text-fg-muted">Kuota</div>
                <div className="mt-0.5 text-xs text-fg">
                  {c.messagingTier.replace("TIER_", "")}
                </div>
              </div>

              <div className="hidden w-20 shrink-0 md:block">
                <div className="text-[10px] text-fg-muted">Percakapan</div>
                <div className="mt-0.5 text-xs text-fg">
                  {c._count.conversations}
                </div>
              </div>

              <ChannelActions
                channelId={c.id}
                paused={c.sendingPaused}
                canManage={user.role !== "AGENT" && user.role !== "VIEWER"}
              />
            </div>
          ))}
        </div>

        <section className="mt-10">
          <Link
            href="/templates"
            className="flex items-center justify-between gap-4 rounded-lg border bg-surface p-4 hover:bg-muted"
          >
            <div>
              <h2 className="text-sm text-fg">Template pesan</h2>
              <p className="mt-1 text-xs text-fg-muted">
                {templateTotal} template · {templateApproved} disetujui
                {templatePending > 0 && <> · {templatePending} menunggu review</>}
                {lastSync && <> · terakhir sinkron {shortTime(lastSync)}</>}
              </p>
            </div>
            <span className="shrink-0 text-xs text-accent">Kelola template →</span>
          </Link>
        </section>

        <section className="mt-10">
          <h2 className="text-sm text-fg">Akun WhatsApp Business</h2>
          <p className="mt-1 mb-3 text-xs text-fg-muted">
            Tiap WABA membawa kredensial Meta App-nya sendiri, jadi punya
            callback URL sendiri. Semua nomor di bawah WABA ikut tersambung saat
            dihubungkan atau disinkron.
          </p>

          <Connections
            canManage={canManage}
            origin={origin}
            rows={connections.map((c) => ({
              id: c.id,
              name: c.name,
              wabaId: c.wabaId,
              metaAppId: c.metaAppId,
              verifyToken: c.verifyToken,
              status: c.status,
              graphVersion: c.graphVersion,
              channelCount: c._count.channels,
              lastSyncAt: c.lastSyncAt ? shortTime(c.lastSyncAt) : null,
              lastError: c.lastError,
            }))}
          />
          {!canManage && (
            <p className="mt-3 text-xs text-fg-muted">
              Hanya admin yang dapat menghubungkan WABA.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
