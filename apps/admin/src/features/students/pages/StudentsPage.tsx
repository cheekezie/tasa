import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Link, useSearchParams } from "react-router-dom";
import {
  useSchools,
  useStudents,
  type StudentRow,
  type StudentVerificationStatus,
} from "@/features/students/api";
import { StudentVerificationCell } from "@/features/students/components/badges";
import { count, date } from "@/lib/format";
import appRoutes, { toPath } from "@/routes/appRoutes";
import { DataTable, type FilterConfig } from "@/shared/components/DataTable";
import { LoadFailed } from "@/shared/components/Metric";
import PageHeader from "@/shared/components/PageHeader";
import { useTableState } from "@/shared/hooks/useTableState";

/** The API caps a page at 100 and refuses a one-letter search. */
const PAGE_SIZE = 50;
const MIN_SEARCH = 2;
const STATUSES = ["pending", "verified", "rejected", "unsubmitted"] as const;

type Filters = { status: StudentVerificationStatus | ""; schoolId: string };

const STATUS_FILTER: FilterConfig = {
  type: "select",
  key: "status",
  label: "Status",
  options: [
    { label: "Pending review", value: "pending" },
    { label: "Verified", value: "verified" },
    { label: "Rejected", value: "rejected" },
    { label: "Not submitted", value: "unsubmitted" },
  ],
};

const studentName = (s: Pick<StudentRow, "name" | "username">) =>
  s.name ?? (s.username ? `@${s.username}` : "Unnamed student");

const columns: ColumnDef<StudentRow, unknown>[] = [
  {
    id: "name",
    header: "Student",
    cell: ({ row }) => (
      <Link
        to={toPath(appRoutes.STUDENT, { id: row.original.id })}
        className="block min-w-44"
      >
        <span className="block truncate font-medium text-primary hover:underline">
          {studentName(row.original)}
        </span>
        {row.original.username && (
          <span className="block truncate text-xs text-grey-400">
            @{row.original.username}
          </span>
        )}
      </Link>
    ),
  },
  {
    id: "school",
    header: "School",
    cell: ({ row }) =>
      row.original.school ? (
        <span title={row.original.school.name}>{row.original.school.shortName}</span>
      ) : (
        <span className="text-grey-300">—</span>
      ),
  },
  {
    id: "department",
    header: "Department",
    cell: ({ row }) => (
      <span className="block max-w-48 truncate">{row.original.department}</span>
    ),
  },
  { id: "level", header: "Level", cell: ({ row }) => row.original.levelLabel },
  {
    id: "matric",
    header: "Matric number",
    cell: ({ row }) => (
      <span className="font-mono text-xs">{row.original.matricNumber}</span>
    ),
  },
  {
    id: "verification",
    header: "Verification",
    cell: ({ row }) => (
      <StudentVerificationCell
        status={row.original.verification.status}
        method={row.original.verification.method}
        revoked={row.original.verification.revoked}
      />
    ),
  },
  {
    id: "updated",
    header: "Updated",
    cell: ({ row }) => (
      <span className="whitespace-nowrap">{date(row.original.updatedAt)}</span>
    ),
  },
];

/** Students who told Tasa their school. Filtered to pending (the default), it's compliance's ID card queue. */
export default function StudentsPage() {
  const [searchParams] = useSearchParams();
  const fromUrl = searchParams.get("status");
  // Pending by default; a link can ask for another status (or "all") and a school (the schools page does).
  const initialStatus =
    fromUrl === "all" ? "" : (STATUSES.find((s) => s === fromUrl) ?? "pending");
  const table = useTableState<Filters>({
    defaultFilters: { status: initialStatus, schoolId: searchParams.get("school") ?? "" },
    pageSize: PAGE_SIZE,
  });
  const { search, page, pageSize, status, schoolId } = table.queryParams;
  const params = useMemo(
    () => ({
      page,
      limit: pageSize,
      status,
      schoolId,
      ...(search.trim().length >= MIN_SEARCH ? { search: search.trim() } : {}),
    }),
    [page, pageSize, status, schoolId, search]
  );
  const query = useStudents(params);
  const schools = useSchools({ page: 1, limit: 100, active: "true" });

  const filters = useMemo<FilterConfig[]>(
    () => [
      STATUS_FILTER,
      {
        type: "select",
        key: "schoolId",
        label: "School",
        searchable: true,
        options: (schools.data?.items ?? []).map((s) => ({
          label: `${s.shortName} · ${s.name}`,
          value: s.id,
        })),
      },
    ],
    [schools.data]
  );
  const isQueue = status === "pending";

  return (
    <>
      <PageHeader
        title={isQueue ? "Student review queue" : "Students"}
        subtitle={
          isQueue
            ? `ID cards waiting for a decision, oldest first.${query.data ? ` ${count(query.data.total)} waiting.` : ""}`
            : "Students verify with a code to their school email, or by sending a photo of their student ID card for Tasa to check."
        }
      />
      {query.isError ? (
        <LoadFailed error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <DataTable
          getRowHref={(s) => toPath(appRoutes.STUDENT, { id: s.id })}
          columns={columns}
          data={query.data?.items ?? []}
          isLoading={query.isPending}
          totalPages={query.data?.totalPages ?? 1}
          totalItems={query.data?.total ?? 0}
          tableState={table}
          filterConfigs={filters}
          searchPlaceholder="Name, username, phone, email, matric number or department"
        />
      )}
    </>
  );
}
