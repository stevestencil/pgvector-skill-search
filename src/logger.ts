/**
 * Minimal logger interface — compatible with Pino, Fastify, console, and any
 * structured logger. Replaces FastifyBaseLogger as a dependency.
 */
export interface Logger {
  info(obj: Record<string, unknown> | string, msg?: string): void;
  warn(obj: Record<string, unknown> | string, msg?: string): void;
  error(obj: Record<string, unknown> | string, msg?: string): void;
}
