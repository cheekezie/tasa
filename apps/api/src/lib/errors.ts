export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
    public errors?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (msg = 'Bad request', code = 'BAD_REQUEST') => new AppError(400, msg, code);
export const unauthorized = (msg = 'Unauthorized') => new AppError(401, msg, 'UNAUTHORIZED');
export const forbidden = (msg = 'Forbidden') => new AppError(403, msg, 'FORBIDDEN');
export const notFound = (msg = 'Not found') => new AppError(404, msg, 'NOT_FOUND');
export const conflict = (msg = 'Conflict', code = 'CONFLICT') => new AppError(409, msg, code);
export const unprocessable = (msg: string, code: string) => new AppError(422, msg, code);
export const tooMany = (msg: string, code = 'RATE_LIMITED') => new AppError(429, msg, code);
/** The provider (SaySwitch) is down or answered with something we can't use. */
export const providerError = (msg = 'Our payment partner is unavailable. Try again shortly') =>
  new AppError(502, msg, 'PROVIDER_ERROR');
