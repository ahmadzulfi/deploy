import { prisma } from '@wa/db'
import { cloudApiProvider, credentialsFor, ProviderError } from '@wa/core'
import { auth, hasRole } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/** What Meta accepts as a header sample, and how big. */
const ACCEPT: Record<string, { types: string[]; maxBytes: number }> = {
  IMAGE: { types: ['image/jpeg', 'image/png'], maxBytes: 5 * 1024 * 1024 },
  VIDEO: { types: ['video/mp4'], maxBytes: 16 * 1024 * 1024 },
  DOCUMENT: { types: ['application/pdf'], maxBytes: 10 * 1024 * 1024 },
}

/**
 * Uploads a media header's sample file for template review and returns the
 * handle the template definition references.
 *
 * A route handler rather than a server action: a sample video can be larger
 * than the server action body limit.
 */
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Belum masuk.' }, { status: 401 })
  if (!hasRole(session.user, 'SUPERVISOR')) {
    return Response.json({ error: 'Membuat template butuh peran supervisor ke atas.' }, { status: 403 })
  }

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  const format = String(form?.get('format') ?? '')
  const wabaId = String(form?.get('wabaId') ?? '')
  const rule = ACCEPT[format]
  if (!(file instanceof File) || !rule) return Response.json({ error: 'File atau jenis header tidak valid.' }, { status: 400 })
  if (!rule.types.includes(file.type)) {
    return Response.json({ error: `Jenis file harus ${rule.types.join(' / ')}.` }, { status: 400 })
  }
  if (file.size > rule.maxBytes) {
    return Response.json({ error: `File maksimal ${rule.maxBytes / 1024 / 1024} MB.` }, { status: 400 })
  }

  const channel = await prisma.channel.findFirst({
    where: { orgId: session.user.orgId, wabaId, accessTokenEnc: { not: null }, phoneNumberId: { not: null } },
    orderBy: { createdAt: 'asc' },
    include: { connection: { select: { metaAppId: true } } },
  })
  if (!channel) return Response.json({ error: 'WABA tidak ditemukan.' }, { status: 404 })

  try {
    const creds = credentialsFor(channel)
    // The connection form asks for the App ID; older numbers never gave one,
    // and the token itself knows which app issued it.
    const appId = channel.connection?.metaAppId || (await cloudApiProvider.appIdForToken(creds))
    const { handle } = await cloudApiProvider.uploadTemplateSample(creds, appId, {
      data: new Uint8Array(await file.arrayBuffer()),
      mimeType: file.type,
      filename: file.name,
    })
    return Response.json({ handle })
  } catch (err) {
    const msg = err instanceof ProviderError && typeof err.details === 'string' && err.details ? `${err.message} — ${err.details}` : err instanceof Error ? err.message : String(err)
    return Response.json({ error: `Upload ke Meta gagal: ${msg}` }, { status: 502 })
  }
}
