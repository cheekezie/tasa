import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { SchoolLogo } from "@/features/students/components/SchoolLogo";
import {
  OWNERSHIP_LABELS,
  KIND_LABELS,
  useSchools,
  useUpdateSchool,
  type SchoolRow,
} from "@/features/students/api";
import { SchoolDialog } from "@/features/students/components/SchoolDialog";
import { count } from "@/lib/format";
import appRoutes, { toPath } from "@/routes/appRoutes";
import { DataTable, type FilterConfig } from "@/shared/components/DataTable";
import { LoadFailed } from "@/shared/components/Metric";
import PageHeader from "@/shared/components/PageHeader";
import { RowActionsMenu } from "@/shared/components/RowActionsMenu";
import StatusBadge from "@/shared/components/StatusBadge";
import { useTableState } from "@/shared/hooks/useTableState";
import { Button } from "@/shared/ui/button";
import { useCan } from "@/stores";

const PAGE_SIZE = 50;

type Filters = { active: "true" | "false" | "" };

const FILTERS: FilterConfig[] = [
  {
    type: "select",
    key: "active",
    label: "Active",
    options: [
      { label: "Active", value: "true" },
      { label: "Switched off", value: "false" },
    ],
  },
];

/** The schools students can pick, and the email domains that verify them. Compliance keeps the list. */
export default function SchoolsPage() {
  const canEdit = useCan("compliance");
  const canEditFaculties = useCan("compliance", "support");
  const navigate = useNavigate();
  const table = useTableState<Filters>({
    defaultFilters: { active: "" },
    pageSize: PAGE_SIZE,
  });
  const { search, page, pageSize, active } = table.queryParams;
  const params = useMemo(
    () => ({
      page,
      limit: pageSize,
      active,
      ...(search.trim() ? { search: search.trim() } : {}),
    }),
    [page, pageSize, active, search]
  );
  const query = useSchools(params);
  const update = useUpdateSchool();
  const [editing, setEditing] = useState<{ school: SchoolRow | null } | null>(null);

  const setActive = (s: SchoolRow, on: boolean) =>
    update.mutate(
      { id: s.id, active: on },
      {
        onSuccess: () =>
          toast.success(
            on
              ? `${s.shortName} is offered to students`
              : `${s.shortName} is switched off`
          ),
      }
    );

  const detail = (s: SchoolRow) => toPath(appRoutes.SCHOOL, { id: s.id });

  const columns: ColumnDef<SchoolRow, unknown>[] = [
    {
      id: "name",
      header: "School",
      cell: ({ row }) => (
        <div className="flex min-w-48 items-center gap-3">
          <SchoolLogo school={row.original} />
          <div className="min-w-0">
            <Link
              to={detail(row.original)}
              state={{ school: row.original }}
              className="block truncate font-medium text-grey-800 hover:text-primary hover:underline"
            >
              {row.original.name}
            </Link>
            <p className="text-xs text-grey-400">
              {row.original.shortName}
              {row.original.ownership && ` · ${OWNERSHIP_LABELS[row.original.ownership]}`}
            </p>
          </div>
        </div>
      ),
    },
    { id: "kind", header: "Kind", cell: ({ row }) => KIND_LABELS[row.original.kind] },
    { id: "state", header: "State", cell: ({ row }) => row.original.state },
    {
      id: "domains",
      header: "Email domains",
      cell: ({ row }) =>
        row.original.emailDomains.length ? (
          <div className="space-y-0.5">
            {row.original.emailDomains.map((d) => (
              <p key={d} className="font-mono text-xs">
                {d}
              </p>
            ))}
          </div>
        ) : (
          <span className="text-xs text-grey-400">ID card only</span>
        ),
    },
    {
      id: "active",
      header: "Active",
      cell: ({ row }) =>
        row.original.active ? (
          <StatusBadge variant="success" label="Active" />
        ) : (
          <StatusBadge variant="inactive" label="Off" />
        ),
    },
    {
      id: "students",
      header: "Students",
      cell: ({ row }) => (
        <div className="text-sm whitespace-nowrap">
          <p>{count(row.original.students.verified)} verified</p>
          {row.original.students.pending > 0 ? (
            <Link
              to={`${appRoutes.STUDENTS}?status=pending&school=${row.original.id}`}
              className="text-xs text-primary hover:underline"
            >
              {count(row.original.students.pending)} pending
            </Link>
          ) : (
            <p className="text-xs text-grey-400">0 pending</p>
          )}
        </div>
      ),
    },
    ...(canEdit || canEditFaculties
      ? [
          {
            id: "actions",
            header: "",
            cell: ({ row }: { row: { original: SchoolRow } }) => {
              const s = row.original;
              return (
                <RowActionsMenu
                  actions={[
                    {
                      label: "Edit",
                      hidden: !canEdit,
                      onClick: () => setEditing({ school: s }),
                    },
                    {
                      label: "Faculties & departments",
                      onClick: () => navigate(detail(s), { state: { school: s } }),
                    },
                    s.active
                      ? {
                          label: "Switch off",
                          hidden: !canEdit,
                          onClick: () => setActive(s, false),
                        }
                      : {
                          label: "Switch on",
                          hidden: !canEdit,
                          onClick: () => setActive(s, true),
                        },
                  ]}
                />
              );
            },
          } satisfies ColumnDef<SchoolRow, unknown>,
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title="Schools"
        subtitle="The schools students can pick in the app. Only active ones are offered."
        actions={
          canEdit
            ? [
                <Button key="new" onClick={() => setEditing({ school: null })}>
                  Add school
                </Button>,
              ]
            : []
        }
      />
      {query.isError ? (
        <LoadFailed error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          data={query.data?.items ?? []}
          isLoading={query.isPending}
          totalPages={query.data?.totalPages ?? 1}
          totalItems={query.data?.total ?? 0}
          tableState={table}
          filterConfigs={FILTERS}
          searchPlaceholder="Name, short name or state"
        />
      )}
      <SchoolDialog
        open={editing !== null}
        school={editing?.school ?? null}
        onOpenChange={(open) => !open && setEditing(null)}
      />
    </>
  );
}
