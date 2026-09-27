import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import { createMDX } from 'fumadocs-mdx/next'

// The monorepo keeps one .env at the root. The playground proxy reads
// PUBLIC_WEBHOOK_ORIGIN from it to know which host it may relay to.
loadEnv({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.env'), quiet: true })

const withMDX = createMDX()

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // The site is the API reference and nothing else; send both roots there.
  async redirects() {
    return [
      { source: '/', destination: '/docs/api', permanent: false },
      { source: '/docs', destination: '/docs/api', permanent: false },
    ]
  },
}

export default withMDX(config)
