import { loader, multiple } from 'fumadocs-core/source'
import { lucideIconsPlugin } from 'fumadocs-core/source/plugins/lucide-icons'
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema'
import { defineDocs } from 'fumadocs-mdx/macro'
import { openapiPlugin } from 'fumadocs-openapi/server'
import { openapi } from './openapi'
import { docsRoute } from './shared'

const docs = defineDocs({
  dir: 'content/docs',
  docs: { schema: pageSchema },
  meta: { schema: metaSchema },
})

export const source = loader({
  baseUrl: docsRoute,
  source: multiple({
    docs: docs.toFumadocsSource(),
    // One page per endpoint under /docs/api/<operationId>. Sidebar order and
    // grouping live in content/docs/api/meta.json, next to the hand-written pages.
    openapi: await openapi.staticSource({ baseDir: 'api', per: 'operation' }),
  }),
  plugins: [lucideIconsPlugin(), openapiPlugin()],
})
