// Logger adapter: pino, JSON to stdout (12-factor). Request IDs are added via
// child loggers at the edge and travel through every agent step.

import { pino, type Logger as PinoLogger } from 'pino';
import type { Logger } from '@plainsheet/core';

export function createLogger(base?: Record<string, unknown>): Logger {
  const root = pino({ level: process.env['LOG_LEVEL'] ?? 'info', base: base ?? {} });
  return wrap(root);
}

function wrap(p: PinoLogger): Logger {
  return {
    info: (msg, fields) => p.info(fields ?? {}, msg),
    warn: (msg, fields) => p.warn(fields ?? {}, msg),
    error: (msg, fields) => p.error(fields ?? {}, msg),
    child: (fields) => wrap(p.child(fields)),
  };
}
