import type { AiEndpoint } from '@wa/db'
import type { AiEndpointConfig } from '../ai.js'
import { decrypt } from './crypto.js'

type Stored = Pick<AiEndpoint, 'method' | 'url' | 'headersEnc' | 'body' | 'answerTemplate' | 'timeoutSeconds'>

/** A saved row as a callable config, headers decrypted. Server side only. */
export function aiConfigOf(row: Stored): AiEndpointConfig {
  return {
    method: row.method === 'GET' ? 'GET' : 'POST',
    url: row.url,
    headers: row.headersEnc ? decrypt(row.headersEnc) : '',
    body: row.body,
    answerTemplate: row.answerTemplate,
    timeoutSeconds: row.timeoutSeconds,
  }
}
