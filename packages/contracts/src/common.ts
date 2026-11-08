// The API's response envelope. Every endpoint answers with one of these two shapes.

export type ApiSuccess<T> = { success: true; statusCode: number; message?: string; data: T };

export type ApiFailure = {
  success: false;
  statusCode: number;
  code?: string;
  message: string;
  /** Field → message, for validation errors. */
  errors?: Record<string, string>;
};

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/** A page of results, as every list endpoint returns them. */
export type Paginated<T> = { items: T[]; page: number; limit: number; total: number; totalPages: number };

/** Sign-in is by phone or email (SMS isn't always delivered). */
export type ContactInput = { type: 'phone' | 'email'; value: string };
