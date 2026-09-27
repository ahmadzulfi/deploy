import { openapi } from '@/lib/openapi'

/**
 * Relay for the playground's "Try it" button.
 *
 * Limited to the webhook service's own origins - an unrestricted proxy on a
 * public docs site would let anyone use it to reach arbitrary hosts.
 */
const allowedOrigins = [
  'http://localhost:3001',
  ...(process.env.PUBLIC_WEBHOOK_ORIGIN ? [process.env.PUBLIC_WEBHOOK_ORIGIN.replace(/\/+$/, '')] : []),
]

export const { GET, POST, PUT, DELETE, PATCH, HEAD } = openapi.createProxy({ allowedOrigins })
