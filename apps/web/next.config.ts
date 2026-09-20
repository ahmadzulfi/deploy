import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import type { NextConfig } from 'next'

// Next reads .env from this app's directory, but the single source of truth
// for the whole monorepo is the root one. Load it here - before the config is
// exported - so AUTH_SECRET, DATABASE_URL and REDIS_URL exist for the server
// runtime, server actions, and route handlers alike.
loadEnv({ path: join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), '.env') })

const config: NextConfig = {
  // @wa/core and @wa/db ship raw TypeScript; Next must compile them itself.
  transpilePackages: ['@wa/core', '@wa/db'],
  experimental: { serverActions: { bodySizeLimit: '8mb' } },

  // Required at runtime on the server, never in a bundle. Leaving bullmq to
  // webpack also drags in its optional valkey driver, which is not installed.
  serverExternalPackages: ['bullmq', 'ioredis', '@prisma/client', 'bcryptjs'],

  webpack(config) {
    // Those packages import siblings as './x.js' - the ESM spelling Node's
    // type stripping requires. Webpack does not map that back to './x.ts' on
    // its own, so teach it to.
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    }
    return config
  },
}

export default config
