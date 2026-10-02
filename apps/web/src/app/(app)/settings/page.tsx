import { prisma } from "@wa/db";
import { API_SCOPES, metaSettings, WEBHOOK_EVENTS } from "@wa/core";
import { requireUser } from "@/lib/auth";
import { MetaSettingsForm } from "@/components/settings/meta-form";
import { ApiKeys } from "@/components/settings/api-keys";
import { WebhookEndpoints } from "@/components/settings/webhook-endpoints";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { cn, shortTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser();
  const canManage = user.role === "OWNER" || user.role === "ADMIN";

  const [settings, org, keys, legacyChannels, endpoints, channels] = await Promise.all([
    metaSettings(user.orgId),
    prisma.organization.findUnique({ where: { id: user.orgId } }),
    prisma.apiKey.findMany({
      where: { orgId: user.orgId, revokedAt: null },
      orderBy: { createdAt: "desc" },
    }),
    // Numbers registered before per-WABA connections still verify webhooks
    // with the org-wide secret, so that form stays only while they exist.
    prisma.channel.findMany({
      where: { orgId: user.orgId, connectionId: null },
      select: { name: true },
    }),
    prisma.webhookEndpoint.findMany({
      where: { orgId: user.orgId },
      orderBy: { createdAt: "asc" },
      include: { deliveries: { orderBy: { createdAt: "desc" }, take: 15 } },
    }),
    prisma.channel.findMany({
      where: { orgId: user.orgId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  // Same origin as the Meta callback: the API is served by the webhook
  // service, which is the process exposed to the internet.
  const apiBase = `${process.env.PUBLIC_WEBHOOK_ORIGIN ?? "https://<tunnel-kamu>"}/api/v1`;
  const stamp = (d: Date) =>
    d.toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-8 p-6">
        <div>
          <h1 className="text-h5 text-fg">Pengaturan</h1>
          <p className="mt-1 text-xs text-fg-muted">
            Akses API dan konfigurasi server. Nomor dan WABA diatur di halaman
            Nomor.
          </p>
        </div>

        <SettingsTabs active="/settings" />

        {legacyChannels.length > 0 && (
          <section>
            <h2 className="text-sm text-fg">Integrasi Meta (lama)</h2>
            <p className="mt-1 mb-3 text-xs text-fg-muted">
              Masih dipakai {legacyChannels.map((c) => c.name).join(", ")} lewat
              callback lama{" "}
              <code className="font-mono">/webhooks/whatsapp</code>. Hubungkan
              WABA-nya di halaman Nomor dan pindahkan callback di Meta — bagian
              ini hilang sendiri setelahnya.
            </p>

            <MetaSettingsForm
              canManage={canManage}
              appSecretSource={settings.source.appSecret}
              verifyToken={org?.webhookVerifyToken ?? settings.verifyToken}
              graphVersion={settings.graphVersion}
            />
          </section>
        )}

        <section>
          <h2 className="text-sm text-fg">API key</h2>
          <p className="mt-1 mb-3 text-xs text-fg-muted">
            Untuk sistem internal lain yang memanggil platform ini. Kunci hanya
            ditampilkan sekali saat dibuat — setelah itu hanya sidik jaringnya
            yang tersimpan.
          </p>

          <ApiKeys
            canManage={canManage}
            scopes={API_SCOPES}
            channels={channels}
            keys={keys.map((k) => ({
              id: k.id,
              name: k.name,
              scopes: k.scopes,
              channels: k.channelIds.map(
                (id) => channels.find((c) => c.id === id)?.name ?? "nomor terhapus",
              ),
              createdAt: shortTime(k.createdAt),
              lastUsedAt: k.lastUsedAt ? shortTime(k.lastUsedAt) : null,
            }))}
          />
          <p className="mt-3 text-xs text-fg-muted">
            Base URL: <code className="font-mono text-fg">{apiBase}</code> ·
            Autentikasi <code className="font-mono">Authorization: Bearer wa_…</code>.
            Dokumentasi lengkap ada di situs docs (<code className="font-mono">pnpm dev:docs</code>), bagian API.
          </p>
        </section>

        <section>
          <h2 className="text-sm text-fg">Webhook keluar</h2>
          <p className="mt-1 mb-3 text-xs text-fg-muted">
            Platform ini mengirim event ke sistem lain lewat POST JSON yang
            ditandatangani HMAC-SHA256. Penerima yang sedang mati tidak
            kehilangan event — pengiriman diulang sampai sekitar 8 jam.
          </p>

          <WebhookEndpoints
            canManage={canManage}
            events={WEBHOOK_EVENTS}
            endpoints={endpoints.map((e) => ({
              id: e.id,
              name: e.name,
              url: e.url,
              events: e.events,
              active: e.active,
              failing:
                !!e.lastFailureAt &&
                (!e.lastSuccessAt || e.lastFailureAt > e.lastSuccessAt),
              lastError: e.lastError,
              deliveries: e.deliveries.map((d) => ({
                id: d.id,
                event: d.event,
                status: d.status,
                attempts: d.attempts,
                responseStatus: d.responseStatus,
                error: d.error,
                createdAt: stamp(d.createdAt),
              })),
            }))}
          />
        </section>

        <section>
          <h2 className="text-sm text-fg">Tetap di berkas .env</h2>
          <p className="mt-1 mb-3 text-xs text-fg-muted">
            Nilai berikut tidak bisa dipindah ke sini: semuanya dibutuhkan
            sebelum database bisa dibaca, dan kunci enkripsi tidak mungkin
            melindungi dirinya sendiri.
          </p>

          <div className="overflow-hidden rounded-lg border bg-surface">
            {[
              [
                "ENCRYPTION_KEY",
                "Melindungi token channel dan app secret di database",
              ],
              ["AUTH_SECRET", "Menandatangani sesi login"],
              ["DATABASE_URL", "Koneksi Postgres"],
              ["REDIS_URL", "Koneksi antrean"],
              [
                "META_GRAPH_VERSION",
                `Versi Graph API — sekarang ${settings.graphVersion}`,
              ],
            ].map(([key, why], i) => (
              <div
                key={key}
                className={cn("flex gap-4 px-4 py-2.5", i > 0 && "border-t")}
              >
                <code className="w-44 shrink-0 font-mono text-[11px] text-fg">
                  {key}
                </code>
                <span className="text-[11px] text-fg-muted">{why}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
