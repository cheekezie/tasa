import { useReviewSeller, useSetSellerSuspension, type SellerDetail } from "@/features/sellers/api";
import { ApiError } from "@/lib/http";
import { useAskAction } from "@/shared/hooks/useAskAction";
import { Button } from "@/shared/ui/button";

/** Someone else got there first: the API says what changed, and the page shows it. */
const STALE = ["SELLER_NOT_PENDING", "SUSPENSION_UNCHANGED"];
const isStale = (err: unknown) => err instanceof ApiError && STALE.includes(err.code);

/** The dialog shows the API's message; refetching puts the current state behind it. */
const refetchIfStale = (onStale: () => void) => (err: unknown) => {
  if (isStale(err)) onStale();
};

const MIN_REASON = 5;

type Props = { seller: SellerDetail; name: string; onStale: () => void };

/** Approve or reject a pending submission. Only rendered for compliance while it's pending. */
export function ReviewActions({ seller, name, onStale }: Props) {
  const review = useReviewSeller(seller.id);
  const { ask } = useAskAction();

  const approve = () =>
    ask({
      title: `Approve ${name}?`,
      variant: "success",
      confirmText: "Approve",
      description: (
        <div className="space-y-2">
          <p>Only approve if the selfie matches the ID and the ID matches the person on this account.</p>
          <p>They can create events straight away, and they're notified that they've been approved. Once approved they can't swap their documents.</p>
        </div>
      ),
      onConfirm: async () => {
        await review.mutateAsync({ status: "approved" });
        return { message: `${name} is approved and can create events. They've been told.` };
      },
      onError: refetchIfStale(onStale),
    });

  const reject = () =>
    ask({
      title: `Reject ${name}?`,
      variant: "danger",
      confirmText: "Reject",
      description: <p>They're notified with your reason and can send new documents. Until they're approved they can't create events.</p>,
      input: {
        label: `Reason (the organiser sees this, at least ${MIN_REASON} characters)`,
        placeholder: "The ID photo is blurry. Take it again in good light with all four corners showing.",
        required: true,
        variant: "textarea",
        minLength: MIN_REASON,
        maxLength: 300,
      },
      onConfirm: async ({ inputValue = "" }) => {
        await review.mutateAsync({ status: "rejected", reason: inputValue });
        return { message: `${name} was rejected and has been sent your reason.` };
      },
      onError: refetchIfStale(onStale),
    });

  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={approve}>
        Approve
      </Button>
      <Button size="sm" variant="destructive" onClick={reject}>
        Reject
      </Button>
    </div>
  );
}

/** Suspend or lift. Compliance and support only. */
export function SuspensionAction({ seller, name, onStale }: Props) {
  const setSuspension = useSetSellerSuspension(seller.id);
  const { ask } = useAskAction();
  const suspending = !seller.suspension.active;

  const suspend = () =>
    ask({
      title: `Suspend ${name}?`,
      variant: "danger",
      confirmText: "Suspend",
      description: (
        <div className="space-y-2 text-left">
          <ul className="list-disc space-y-1 pl-5">
            <li>Every event of theirs still selling is paused as Tasa. They can't undo that pause.</li>
            <li>They can't create new events.</li>
            <li>Withdrawals from their ticket balance are held.</li>
          </ul>
          <p>Tickets already sold stay valid: buyers can still ask for refunds and the door can still scan. They're notified with your reason.</p>
        </div>
      ),
      input: {
        label: `Reason (the organiser sees this, at least ${MIN_REASON} characters)`,
        placeholder: "Several buyers reported this event didn't happen.",
        required: true,
        variant: "textarea",
        minLength: MIN_REASON,
        maxLength: 300,
      },
      onConfirm: async ({ inputValue = "" }) => {
        await setSuspension.mutateAsync({ suspended: true, reason: inputValue });
        return { message: `${name} is suspended and their events are paused.` };
      },
      onError: refetchIfStale(onStale),
    });

  const lift = () =>
    ask({
      title: `Lift ${name}'s suspension?`,
      variant: "primary",
      confirmText: "Lift suspension",
      description: (
        <div className="space-y-2">
          <p>
            The events this suspension paused go back on sale straight away. Events staff paused by hand, or that the organiser paused themselves,
            stay paused.
          </p>
          <p>They can create events and withdraw again, and they're notified.</p>
        </div>
      ),
      input: {
        label: "Why (optional, kept in the history)",
        placeholder: "Checked with the venue: the event is real.",
        variant: "textarea",
        maxLength: 300,
      },
      onConfirm: async ({ inputValue }) => {
        await setSuspension.mutateAsync({ suspended: false, ...(inputValue ? { reason: inputValue } : {}) });
        return { message: `Suspension lifted. ${name}'s paused events are back on sale.` };
      },
      onError: refetchIfStale(onStale),
    });

  return (
    <Button className="shrink-0" variant={suspending ? "destructive" : "default"} onClick={suspending ? suspend : lift}>
      {suspending ? "Suspend organiser" : "Lift suspension"}
    </Button>
  );
}
