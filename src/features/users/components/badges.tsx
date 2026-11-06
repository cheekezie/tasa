import type { BvnStatus, UserProfile, UserStatus } from "@/features/users/api";
import StatusBadge, { type StatusVariant } from "@/shared/components/StatusBadge";

const STATUS_VARIANT: Record<UserStatus, StatusVariant> = { active: "success", suspended: "warning", closed: "closed" };
const BVN_VARIANT: Record<BvnStatus, StatusVariant> = { pending: "warning", verified: "success", rejected: "error" };

export const UserStatusBadge = ({ status }: { status: UserStatus }) => <StatusBadge variant={STATUS_VARIANT[status]} label={status} />;

/** BVN state with its last 4 digits. The full number is only ever shown in the reveal modal. */
export function BvnBadge({ bvn }: { bvn: UserProfile["bvn"] }) {
  if (!bvn) return <span className="text-grey-300">Not added</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <StatusBadge variant={BVN_VARIANT[bvn.status]} label={bvn.status} />
      {bvn.last4 && <span className="font-mono text-xs text-grey-400">•••• {bvn.last4}</span>}
    </span>
  );
}
