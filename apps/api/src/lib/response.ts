import type { FastifyReply } from 'fastify';
import type { ZodType } from 'zod';
import { AppError } from './errors';

export type ApiSuccess<T> = { success: true; statusCode: number; message?: string; data: T };
export type Paginated<T> = { items: T[]; page: number; limit: number; total: number; totalPages: number };

export function send<T>(reply: FastifyReply, data: T, statusCode = 200, message?: string) {
  const body: ApiSuccess<T> = { success: true, statusCode, data };
  if (message) body.message = message;
  return reply.status(statusCode).send(body);
}

/**
 * Validates input against a schema and throws a 400 with a field → message map on
 * failure. Routes call this on body/query/params.
 */
export function parse<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input ?? {});
  if (result.success) return result.data;

  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const field = issue.path.join('.') || 'value';
    errors[field] ??= issue.message;
  }
  throw new AppError(400, Object.values(errors)[0] ?? 'Invalid input', 'VALIDATION_ERROR', errors);
}

export function paginate<T>(items: T[], total: number, page: number, limit: number): Paginated<T> {
  return { items, page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}
