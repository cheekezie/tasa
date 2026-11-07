import { request } from '../client';
import { UPLOAD_TIMEOUT_MS, appendImage } from './account';
import { OtpSentDto, SchoolDto, SchoolFacultiesDto, StudentProfileDto, StudentProfileInput, StudentTermsDto } from '../types';

export const studentsService = {
  /** Active schools, by name, short name or state. */
  schools: (search?: string) => request<SchoolDto[]>('/students/schools', { query: { search } }),
  /** Its own faculties and departments, or the general list while it has none. */
  faculties: (schoolId: string) => request<SchoolFacultiesDto>(`/students/schools/${encodeURIComponent(schoolId)}/faculties`),
  /** "Are you a student?": the terms, and whether they've accepted this version. */
  terms: () => request<StudentTermsDto>('/students/terms'),
  /** `STUDENT_TERMS_CHANGED` when `version` is no longer current. */
  acceptTerms: (version: number) => request<StudentTermsDto>('/students/terms', { method: 'POST', body: { acceptTerms: version } }),
  /** Department names classmates already use at a school, most common first. */
  departments: (schoolId: string, search?: string) => request<string[]>('/students/departments', { query: { schoolId, search } }),
  /** null until they've saved one. */
  me: () => request<StudentProfileDto | null>('/students/me'),
  /** Changing school, department or matric number undoes a verification. `STUDENT_TERMS_REQUIRED` before the terms are accepted. */
  save: (input: StudentProfileInput) => request<StudentProfileDto>('/students/me', { method: 'PUT', body: input }),
  sendEmailCode: (email: string) => request<OtpSentDto>('/students/me/email', { method: 'POST', body: { email } }),
  verifyEmail: (email: string, code: string) => request<StudentProfileDto>('/students/me/email/verify', { method: 'POST', body: { email, code } }),
  /** A photo of their student ID card, for Tasa staff to check. */
  async submitCard(uri: string) {
    const body = new FormData();
    await appendImage(body, 'card', uri);
    return request<StudentProfileDto>('/students/me/card', { method: 'POST', body, timeoutMs: UPLOAD_TIMEOUT_MS });
  },
};
