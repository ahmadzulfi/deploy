import { prisma } from '@wa/db'
import { credentialsFor, providerFor, ProviderError } from '@wa/core'
import { auth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * Streams a message's media from Meta to the inbox.
 *
 * Meta's download URLs demand the channel's token, so the browser cannot load
 * them itself. Only media stored as a Meta media id comes through here; media
 * sent by link is shown straight from that link.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ messageId: string }> }) {
  const session = await auth()
  if (!session?.user) return new Response('unauthorized', { status: 401 })

  const { messageId } = await ctx.params
  const m = await prisma.message.findUnique({
    where: { id: messageId },
    include: { conversation: { include: { channel: true } } },
  })
  // Another org's message is "not found", not forbidden: no hint that it exists.
  if (!m || m.conversation.channel.orgId !== session.user.orgId) return new Response('not found', { status: 404 })

  const p = (m.payload ?? {}) as { mediaId?: string; filename?: string }
  if (!p.mediaId) return new Response('no media', { status: 404 })

  const channel = m.conversation.channel
  try {
    const provider = providerFor(channel)
    const creds = credentialsFor(channel)
    const { url, mimeType } = await provider.getMediaUrl(creds, p.mediaId)
    const res = await provider.downloadMedia(creds, url)

    return new Response(res.body, {
      headers: {
        'Content-Type': mimeType,
        // Private: the file is someone's conversation, not a public asset.
        'Cache-Control': 'private, max-age=3600',
        'Content-Disposition': `inline${p.filename ? `; filename*=UTF-8''${encodeURIComponent(p.filename)}` : ''}`,
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (err) {
    // Meta keeps media for a limited time; an old message's file may be gone.
    const status = err instanceof ProviderError && err.httpStatus === 404 ? 404 : 502
    return new Response(err instanceof Error ? err.message : 'gagal mengambil media', { status })
  }
}
