import { z } from 'zod'
import { loadEnvFile } from './load-env.js'

const schema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  ENCRYPTION_KEY: z.string().min(1, 'run: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"'),

  // The App ID is deliberately absent: nothing here needs it. Webhook
  // signatures use the app secret, and every Graph call is authenticated by
  // the channel's own token. Add it back only if Embedded Signup lands.
  META_APP_SECRET: z.string().min(1),
  META_GRAPH_VERSION: z.string().default('v21.0'),
  WEBHOOK_VERIFY_TOKEN: z.string().min(1),

  WEBHOOK_PORT: z.coerce.number().default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
})

export type Env = z.infer<typeof schema>

let cached: Env | null = null

/** Fails loudly at boot rather than at the first send. */
export function env(): Env {
  if (cached) return cached
  loadEnvFile()
  const parsed = schema.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Invalid environment:\n${issues}`)
  }
  cached = parsed.data
  return cached
}
