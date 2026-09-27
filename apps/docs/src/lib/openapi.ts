import { createOpenAPI } from 'fumadocs-openapi/server'

/**
 * The Public API reference is generated from this one file. Editing an
 * endpoint means editing openapi.yaml - the pages, code samples and the
 * "Try it" playground all follow from it.
 */
export const openapi = createOpenAPI({
  input: ['./openapi.yaml'],
  // Browsers cannot call the webhook service directly: it sends no CORS
  // headers, and should not. The playground goes through our own route.
  proxyUrl: '/api/proxy',
})
