import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { UserStatus } from "@/features/users/api";
import { api, http, type Paginated } from "@/lib/http";

export type StudentVerificationStatus =
  "unsubmitted" | "pending" | "verified" | "rejected";
export type StudentVerificationMethod = "email" | "id_card";
export type SchoolKind = "university" | "polytechnic" | "college";
export type SchoolOwnership = "federal" | "state" | "private";

/** `schoolDto`. A code to an address on `emailDomains` verifies a student; none means ID card only. */
export type School = {
  id: string;
  name: string;
  shortName: string;
  kind: SchoolKind;
  ownership: SchoolOwnership | null;
  state: string;
  logoUrl: string | null;
  emailDomains: string[];
};

/** GET /admin/schools rows. */
export type SchoolRow = School & {
  active: boolean;
  website: string | null;
  students: { verified: number; pending: number };
  createdAt: string;
};

/** `verificationDto`: no card key, the card only leaves the API through the card endpoint. */
export type StudentVerification = {
  status: StudentVerificationStatus;
  method: StudentVerificationMethod | null;
  /** Only when they verified by school email. */
  email: string | null;
  submittedAt: string | null;
  verifiedAt: string | null;
  /** Only set while rejected. */
  reason: string | null;
  /** Staff took back their verification: only an ID card review verifies them again. */
  revoked: boolean;
};

/** What they're studying for. Levels run 1–5 within a programme (3 on undergraduate is 300 level, 1 on ND is ND1). */
export type Programme =
  | "undergraduate"
  | "part_time"
  | "masters"
  | "doctorate"
  | "pgd"
  | "nd"
  | "hnd"
  | "nce"
  | "diploma"
  | "jupeb"
  | "ijmb"
  | "pre_degree"
  | "pre_science"
  | "foundation";

type StudentProfile = {
  school: School | null;
  faculty: string | null;
  department: string;
  programme: Programme;
  /** 1–5 within the programme. Show `levelLabel`. */
  level: number;
  /** How the level reads: "300 level", "ND1", "Year 1 · Master’s". */
  levelLabel: string;
  matricNumber: string;
  admissionYear: number;
  verification: StudentVerification;
};

/** GET /admin/students rows. `id` is the student's user id. */
export type StudentRow = StudentProfile & {
  id: string;
  name: string | null;
  username: string | null;
  updatedAt: string;
};

/** GET /admin/students/:id. */
export type StudentDetail = Omit<StudentProfile, "verification"> & {
  id: string;
  verification: StudentVerification & {
    hasCard: boolean;
    reviewedAt: string | null;
    reviewedBy: string | null;
  };
  user: {
    name: string | null;
    username: string | null;
    phone: string | null;
    email: string | null;
    avatarUrl: string | null;
    status: UserStatus;
    joinedAt: string;
  } | null;
};

export const METHOD_LABELS: Record<StudentVerificationMethod, string> = {
  email: "School email",
  id_card: "ID card",
};
export const OWNERSHIP_LABELS: Record<SchoolOwnership, string> = {
  federal: "Federal",
  state: "State",
  private: "Private",
};
export const PROGRAMME_LABELS: Record<Programme, string> = {
  undergraduate: "Undergraduate",
  part_time: "Part-time / Sandwich",
  masters: "Master’s",
  doctorate: "Doctorate (PhD)",
  pgd: "Postgraduate Diploma",
  nd: "National Diploma (ND)",
  hnd: "Higher National Diploma (HND)",
  nce: "NCE",
  diploma: "Diploma",
  jupeb: "JUPEB",
  ijmb: "IJMB",
  pre_degree: "Pre-degree",
  pre_science: "Pre-science",
  foundation: "Foundation",
};
export const KIND_LABELS: Record<SchoolKind, string> = {
  university: "University",
  polytechnic: "Polytechnic",
  college: "College",
};

export type StudentsParams = {
  page: number;
  limit: number;
  status?: StudentVerificationStatus | "";
  schoolId?: string;
  search?: string;
};

const KEY = ["students"] as const;
const SCHOOLS = ["schools"] as const;

export const useStudents = (params: StudentsParams) =>
  useQuery({
    queryKey: [...KEY, "list", params],
    queryFn: () => api.get<Paginated<StudentRow>>("/admin/students", params),
    placeholderData: keepPreviousData,
  });

export const useStudent = (id: string) =>
  useQuery({
    queryKey: [...KEY, "detail", id],
    queryFn: () => api.get<StudentDetail>(`/admin/students/${id}`),
  });

export type StudentDecision =
  { status: "verified" } | { status: "rejected"; reason: string };

/** Answers with the student as they now stand. Schools' counts move too. */
export function useReviewStudent(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (decision: StudentDecision) =>
      api.post<StudentDetail>(`/admin/students/${id}/review`, decision),
    onSuccess: (student) => {
      client.setQueryData([...KEY, "detail", id], student);
      void client.invalidateQueries({ queryKey: [...KEY, "list"] });
      void client.invalidateQueries({ queryKey: [...SCHOOLS, "list"] });
    },
  });
}

/** Takes back any verification (compliance). Answers with the student as they now stand. */
export function useRevokeStudent(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) =>
      api.post<StudentDetail>(`/admin/students/${id}/revoke`, { reason }),
    onSuccess: (student) => {
      client.setQueryData([...KEY, "detail", id], student);
      void client.invalidateQueries({ queryKey: [...KEY, "list"] });
      void client.invalidateQueries({ queryKey: [...SCHOOLS, "list"] });
    },
  });
}

/**
 * The decrypted ID card, as raw bytes. A mutation, never a query: the file must not sit in
 * the cache, and each call is logged by the API, so it only runs when asked.
 */
export const useStudentCard = (id: string) =>
  useMutation({
    mutationFn: async () =>
      (
        await http.post<Blob>(`/admin/students/${id}/card`, undefined, {
          responseType: "blob",
        })
      ).data,
  });

export type SchoolsParams = {
  page: number;
  limit: number;
  active?: "true" | "false" | "";
  search?: string;
};

export const useSchools = (params: SchoolsParams) =>
  useQuery({
    queryKey: [...SCHOOLS, "list", params],
    queryFn: () => api.get<Paginated<SchoolRow>>("/admin/schools", params),
    placeholderData: keepPreviousData,
  });

export type SchoolInput = {
  name: string;
  shortName: string;
  kind: SchoolKind;
  ownership?: SchoolOwnership;
  state: string;
  website?: string;
  emailDomains: string[];
  active: boolean;
};

function useSchoolsChanged() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: [...SCHOOLS, "list"] });
    void client.invalidateQueries({ queryKey: [...SCHOOLS, "detail"] });
  };
}

/**
 * One school, shown at once from `initial` (handed over by the link) or a loaded list page,
 * then read fresh from the API.
 */
export function useSchool(id: string, initial?: SchoolRow) {
  const client = useQueryClient();
  return useQuery({
    queryKey: [...SCHOOLS, "detail", id],
    queryFn: () => api.get<SchoolRow>(`/admin/schools/${id}`),
    initialData: () =>
      initial?.id === id
        ? initial
        : client
            .getQueriesData<Paginated<SchoolRow>>({ queryKey: [...SCHOOLS, "list"] })
            .flatMap(([, data]) => data?.items ?? [])
            .find((s) => s.id === id),
  });
}

export function useCreateSchool() {
  const changed = useSchoolsChanged();
  return useMutation({
    mutationFn: (input: SchoolInput) =>
      api.post<School & { active: boolean }>("/admin/schools", input),
    onSuccess: changed,
  });
}

export function useUpdateSchool() {
  const changed = useSchoolsChanged();
  return useMutation({
    mutationFn: ({ id, ...input }: Partial<SchoolInput> & { id: string }) =>
      api.patch<School & { active: boolean }>(`/admin/schools/${id}`, input),
    onSuccess: changed,
  });
}

/** Replaces the school's logo (multipart, one image). */
export function useUploadSchoolLogo() {
  const changed = useSchoolsChanged();
  return useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => {
      const form = new FormData();
      form.append("file", file);
      return api.post<School & { active: boolean }>(`/admin/schools/${id}/logo`, form);
    },
    onSuccess: changed,
  });
}

export type Faculty = { name: string; departments: string[] };

/** A department students typed that isn't on the school's list (or the general one). */
export type UnlistedDepartment = {
  department: string;
  /** The faculty they typed with it, if any. */
  faculty: string | null;
  students: number;
};

/** GET /admin/schools/:id/faculties. `faculties` empty = students see `general`. */
export type SchoolFaculties = {
  faculties: Faculty[];
  general: Faculty[];
  unlisted: UnlistedDepartment[];
};

export const FACULTY_LIMITS = {
  faculties: 40,
  departments: 80,
  minName: 2,
  maxName: 80,
} as const;

export const useSchoolFaculties = (id: string) =>
  useQuery({
    queryKey: [...SCHOOLS, "faculties", id],
    queryFn: () => api.get<SchoolFaculties>(`/admin/schools/${id}/faculties`),
  });

/** Replaces the whole list; empty brings back the general one. Answers with the list and what's still unlisted. */
export function useSetSchoolFaculties(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (faculties: Faculty[]) =>
      api.put<Pick<SchoolFaculties, "faculties" | "unlisted">>(
        `/admin/schools/${id}/faculties`,
        { faculties }
      ),
    onSuccess: (saved) =>
      client.setQueryData<SchoolFaculties>([...SCHOOLS, "faculties", id], (old) =>
        old ? { ...old, ...saved } : old
      ),
  });
}
