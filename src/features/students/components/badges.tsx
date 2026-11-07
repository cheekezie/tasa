import {
  METHOD_LABELS,
  type StudentVerificationMethod,
  type StudentVerificationStatus,
} from "@/features/students/api";
import StatusBadge, { type StatusVariant } from "@/shared/components/StatusBadge";

const STATUS: Record<
  StudentVerificationStatus,
  { variant: StatusVariant; label: string }
> = {
  pending: { variant: "warning", label: "Pending review" },
  verified: { variant: "success", label: "Verified" },
  rejected: { variant: "error", label: "Rejected" },
  unsubmitted: { variant: "inactive", label: "Not submitted" },
};

/** `revoked` (staff took back their verification) shows instead of plain "Rejected". */
export const StudentStatusBadge = ({
  status,
  revoked = false,
}: {
  status: StudentVerificationStatus;
  revoked?: boolean;
}) =>
  revoked && status === "rejected" ? (
    <StatusBadge variant="error" label="Revoked" />
  ) : (
    <StatusBadge variant={STATUS[status].variant} label={STATUS[status].label} />
  );

/** Status with how they verified (or tried to) underneath. */
export const StudentVerificationCell = ({
  status,
  method,
  revoked = false,
}: {
  status: StudentVerificationStatus;
  method: StudentVerificationMethod | null;
  revoked?: boolean;
}) => (
  <div className="space-y-1">
    <StudentStatusBadge status={status} revoked={revoked} />
    {method && <p className="text-xs text-grey-400">{METHOD_LABELS[method]}</p>}
  </div>
);
