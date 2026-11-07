import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { hasCode } from '@/lib/api/errors';
import { studentsService } from '@/lib/api/services/students';
import { StudentProfileDto, StudentProfileInput } from '@/lib/api/types';
import { queryKeys } from '@/lib/queryClient';

/** "Are you a student?": the student profile opens once `accepted`. */
export function useStudentTerms() {
  return useQuery({ queryKey: queryKeys.studentTerms, queryFn: studentsService.terms });
}

/** Accepts the version they read; if the terms changed meanwhile, fetch the new ones to read again. */
export function useAcceptStudentTerms() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: studentsService.acceptTerms,
    onSuccess: (terms) => client.setQueryData(queryKeys.studentTerms, terms),
    onError: (error) => {
      if (hasCode(error, 'STUDENT_TERMS_CHANGED')) client.invalidateQueries({ queryKey: queryKeys.studentTerms });
    },
  });
}

/** Their student profile; `data` is null until they've saved one. */
export function useStudentProfile() {
  return useQuery({ queryKey: queryKeys.studentProfile, queryFn: studentsService.me });
}

export function useSchools(search: string) {
  const term = search.trim();
  return useQuery({
    queryKey: queryKeys.schools(term),
    queryFn: () => studentsService.schools(term || undefined),
    placeholderData: (previous) => previous,
  });
}

/** The school's faculties and departments to choose from (its own, or the general list). */
export function useFaculties(schoolId: string | null) {
  return useQuery({
    queryKey: queryKeys.faculties(schoolId ?? ''),
    queryFn: () => studentsService.faculties(schoolId!),
    enabled: !!schoolId,
  });
}

/** What classmates call their departments, to pick from instead of typing a new spelling. */
export function useDepartments(schoolId: string | null, search: string) {
  const term = search.trim();
  return useQuery({
    queryKey: queryKeys.departments(schoolId ?? '', term),
    queryFn: () => studentsService.departments(schoolId!, term || undefined),
    enabled: !!schoolId,
    placeholderData: (previous) => previous,
  });
}

/** Every change answers with the profile. */
function useProfileMutation<V>(fn: (variables: V) => Promise<StudentProfileDto | null>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (profile) => {
      client.setQueryData(queryKeys.studentProfile, profile);
    },
    // Terms they haven't accepted (or that changed since): refetching them brings "Are you a student?" back.
    onError: (error) => {
      if (hasCode(error, 'STUDENT_TERMS_REQUIRED', 'STUDENT_TERMS_CHANGED')) client.invalidateQueries({ queryKey: queryKeys.studentTerms });
    },
  });
}

export const useSaveStudentProfile = () => useProfileMutation((input: StudentProfileInput) => studentsService.save(input));
export const useVerifySchoolEmail = () =>
  useProfileMutation(({ email, code }: { email: string; code: string }) => studentsService.verifyEmail(email, code));
export const useSubmitStudentCard = () => useProfileMutation((uri: string) => studentsService.submitCard(uri));
export const useSendSchoolEmailCode = () => useMutation({ mutationFn: studentsService.sendEmailCode });

/** `value`, once it has stopped changing for `ms`: for searches as they type. */
export function useDebouncedValue<T>(value: T, ms = 300) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}
