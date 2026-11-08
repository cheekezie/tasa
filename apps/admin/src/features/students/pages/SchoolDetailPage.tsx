import { useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  KIND_LABELS,
  OWNERSHIP_LABELS,
  useSchool,
  useSchoolFaculties,
  type SchoolRow,
} from "@/features/students/api";
import { FacultiesSection } from "@/features/students/components/FacultiesSection";
import { SchoolDialog } from "@/features/students/components/SchoolDialog";
import { SchoolLogo } from "@/features/students/components/SchoolLogo";
import appRoutes from "@/routes/appRoutes";
import BackButton from "@/shared/components/BackButton";
import { DetailPageSkeleton } from "@/shared/components/DetailPageSkeleton";
import { LoadFailed } from "@/shared/components/Metric";
import StatusBadge from "@/shared/components/StatusBadge";
import { Button } from "@/shared/ui/button";
import { useCan } from "@/stores";

/** One school: its details, and the faculties and departments its students pick from. */
export default function SchoolDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const passed = (location.state as { school?: SchoolRow } | null)?.school;
  const school = useSchool(id, passed);
  const faculties = useSchoolFaculties(id);
  const canEditSchool = useCan("compliance");
  const canEditFaculties = useCan("compliance", "support");
  const [editing, setEditing] = useState(false);
  const s = school.data;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start gap-3">
        <BackButton onClick={() => navigate(appRoutes.SCHOOLS)} />
        {s && (
          <>
            <SchoolLogo school={s} className="size-12" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-heading text-2xl font-semibold text-grey-800">
                  {s.name}
                </h1>
                {s.active ? (
                  <StatusBadge variant="success" label="Active" />
                ) : (
                  <StatusBadge variant="inactive" label="Off" />
                )}
              </div>
              <p className="text-sm text-grey-400">
                {[
                  s.shortName,
                  KIND_LABELS[s.kind],
                  s.ownership && OWNERSHIP_LABELS[s.ownership],
                  s.state,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            {canEditSchool && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
          </>
        )}
      </div>

      {school.isError && (
        <div className="mb-6">
          <LoadFailed error={school.error} onRetry={() => school.refetch()} />
        </div>
      )}
      {faculties.isError && (
        <LoadFailed error={faculties.error} onRetry={() => faculties.refetch()} />
      )}
      {faculties.isPending && <DetailPageSkeleton sectionCount={2} documentCount={0} />}
      {faculties.data && (
        <FacultiesSection
          key={id}
          schoolId={id}
          data={faculties.data}
          canEdit={canEditFaculties}
        />
      )}

      <SchoolDialog
        open={editing && !!s}
        school={s ?? null}
        onOpenChange={(open) => !open && setEditing(false)}
      />
    </>
  );
}
