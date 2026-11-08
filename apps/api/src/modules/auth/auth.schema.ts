import { z } from 'zod';
import { ContactSchema } from '../../lib/schemas';

const CodeSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') });

/** `{ type: 'phone', value: '0803…' }` or `{ type: 'email', value: 'ada@example.com' }`. */
export const OtpRequestSchema = ContactSchema;
export const OtpVerifySchema = z.intersection(ContactSchema, CodeSchema);
export const RefreshSchema = z.object({ refreshToken: z.string().min(20) });
export const LogoutSchema = z.object({ refreshToken: z.string().min(20).optional() });
export const AdminLoginSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(8) });
