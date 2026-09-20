import pino from 'pino'

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  // Access tokens and message bodies must never reach the log sink.
  redact: {
    paths: [
      'accessToken',
      'accessTokenEnc',
      'channel.accessTokenEnc',
      'req.headers.authorization',
      'req.headers["x-hub-signature-256"]',
      '*.accessToken',
    ],
    censor: '[redacted]',
  },
})

export type Logger = typeof logger
