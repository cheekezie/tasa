import type { SellerSuspension, SellerVerificationStatus } from "@/features/sellers/api";
import StatusBadge, { type StatusVariant } from "@/shared/components/StatusBadge";

const VERIFICATION: Record<SellerVerificationStatus, { variant: StatusVariant; label: string }> = {
  pending: { variant: "warning", label: "Pending review" },
  approved: { variant: "success", label: "Approved" },
  rejected: { variant: "error", label: "Rejected" },
  unsubmitted: { variant: "inactive", label: "Not submitted" },
};

export const VerificationBadge = ({ status }: { status: SellerVerificationStatus }) => (
  <StatusBadge variant={VERIFICATION[status].variant} label={VERIFICATION[status].label} />
);

export const SuspendedBadge = ({ suspension }: { suspension: SellerSuspension }) =>
  suspension.active ? <StatusBadge variant="error" label="Suspended" /> : null;

/** Their logo, or their initial when they haven't added one. */
export function SellerLogo({ url, name, size = "sm" }: { url: string | null; name: string; size?: "sm" | "lg" }) {
  const box = size === "lg" ? "size-14 text-lg" : "size-9 text-sm";
  return url ? (
    <img src={url} alt="" className={`${box} shrink-0 rounded-lg border border-grey-50 object-cover`} />
  ) : (
    <span className={`${box} flex shrink-0 items-center justify-center rounded-lg bg-grey-25 font-semibold text-grey-500`}>
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}
