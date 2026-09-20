import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

let loaded = false

/**
 * Loads the repo-root `.env` no matter which app booted.
 *
 * `dotenv/config` reads from the process cwd, which for `pnpm --filter @wa/x`
 * is that package's own directory - so every service would miss the single
 * .env at the root. Anchoring on this file's location and walking up to the
 * workspace marker makes the lookup independent of cwd.
 */
export function loadEnvFile(): void {
  if (loaded) return
  loaded = true

  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      config({ path: join(dir, '.env') })
      return
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  // No workspace marker: a bundled single-directory deploy. Use cwd.
  config()
}
