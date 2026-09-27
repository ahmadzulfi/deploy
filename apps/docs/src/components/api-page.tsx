'use client'

import { createOpenAPIPage } from 'fumadocs-openapi/ui'
import {
  createCodeUsageGeneratorRegistry,
  type CodeUsageGenerator,
} from 'fumadocs-openapi/requests/generators'
import { curl } from 'fumadocs-openapi/requests/generators/curl'
import { go } from 'fumadocs-openapi/requests/generators/go'
import { java } from 'fumadocs-openapi/requests/generators/java'
import { javascript } from 'fumadocs-openapi/requests/generators/javascript'
import { python } from 'fumadocs-openapi/requests/generators/python'

/** Not built in. cURL extension, because it ships with every PHP install. */
const php: CodeUsageGenerator = {
  label: 'PHP',
  lang: 'php',
  generate(data) {
    const headers = Object.entries(data.header).map(([k, v]) => `${k}: ${String(v.value)}`)
    const lines = [
      '<?php',
      '',
      '$ch = curl_init();',
      '',
      'curl_setopt_array($ch, [',
      `    CURLOPT_URL => ${phpString(data.url)},`,
      `    CURLOPT_CUSTOMREQUEST => ${phpString(data.method.toUpperCase())},`,
      '    CURLOPT_RETURNTRANSFER => true,',
    ]

    let body: string | undefined
    if (data.body !== undefined && data.bodyMediaType) {
      headers.push(`Content-Type: ${data.bodyMediaType}`)
      body =
        data.bodyMediaType === 'application/json'
          ? JSON.stringify(data.body, null, 4)
          : String(data.body)
    }

    if (headers.length) {
      lines.push('    CURLOPT_HTTPHEADER => [')
      for (const h of headers) lines.push(`        ${phpString(h)},`)
      lines.push('    ],')
    }
    // A nowdoc takes the JSON verbatim - no quote or backslash escaping.
    if (body !== undefined) lines.push(`    CURLOPT_POSTFIELDS => <<<'JSON'\n${body}\nJSON,`)

    lines.push(
      ']);',
      '',
      '$response = curl_exec($ch);',
      'curl_close($ch);',
      '',
      'echo $response;',
    )
    return lines.join('\n')
  },
}

function phpString(s: string) {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

const codeUsages = createCodeUsageGeneratorRegistry()
codeUsages.add('curl', curl)
codeUsages.add('python', python)
codeUsages.add('js', javascript)
codeUsages.add('php', php)
codeUsages.add('go', go)
codeUsages.add('java', java)

export const OpenAPIPage = createOpenAPIPage({ codeUsages })
