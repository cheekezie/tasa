import { useState } from "react";
import { toast } from "sonner";
import { useDecideBvn, useRevealBvn } from "@/features/users/api";
import { ApiError } from "@/lib/http";
import { ConfirmationModal } from "@/shared/components/ConfirmationModal";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { Textarea } from "@/shared/ui/textarea";
import { useAskAction } from "@/shared/hooks/useAskAction";

/** Someone else decided first: say so and show the current state. */
const notPending = (err: unknown) => err instanceof ApiError && err.code === "BVN_NOT_PENDING";

/** Verify, reject or reveal a pending BVN. Only rendered for compliance while the BVN is pending. */
export function BvnActions({ userId, currentName, onStale }: { userId: string; currentName: string | null; onStale: () => void }) {
  const { ask } = useAskAction();
  const decide = useDecideBvn(userId);
  const [revealing, setRevealing] = useState(false);
  // Someone else decided first: the page refetches, and the dialog shows the API's message.
  const refetchIfStale = (err: unknown) => notPending(err) && onStale();

  /** Approving can also set the legal name; once set it locks for the user. */
  const verify = () =>
    ask({
      title: "Verify this BVN?",
      variant: "success",
      confirmText: "Verify BVN",
      description: "The user is told their BVN is verified. This can't be undone from the back office.",
      input: {
        label: "Legal name from the BVN record (optional)",
        placeholder: currentName ?? "As it appears on the BVN",
        minLength: 2,
        maxLength: 80,
      },
      onConfirm: async ({ inputValue }) => {
        await decide.mutateAsync({ status: "verified", ...(inputValue ? { fullName: inputValue } : {}) });
        return { message: "BVN verified. The user has been told." };
      },
      onError: refetchIfStale,
    });

  const reject = () =>
    ask({
      title: "Reject this BVN?",
      variant: "danger",
      confirmText: "Reject BVN",
      description: "The stored BVN is deleted and the user is sent your reason, so they can add it again.",
      input: {
        label: "Reason (the user sees this)",
        placeholder: "The name on this BVN doesn't match your account.",
        variant: "textarea",
        required: true,
        minLength: 5,
        maxLength: 200,
      },
      onConfirm: async ({ inputValue }) => {
        await decide.mutateAsync({ status: "rejected", reason: inputValue ?? "" });
        return { message: "BVN rejected. The user has been told why." };
      },
      onError: refetchIfStale,
    });

  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={verify}>
        Verify
      </Button>
      <Button size="sm" variant="destructive" onClick={reject}>
        Reject
      </Button>
      <Button size="sm" variant="outline" onClick={() => setRevealing(true)}>
        Reveal full BVN
      </Button>
      {/* Reveal keeps its own dialog: it has to show the number after confirming. */}
      <RevealModal open={revealing} onClose={() => setRevealing(false)} userId={userId} onStale={onStale} />
    </div>
  );
}

type ModalProps = { open: boolean; onClose: () => void; userId: string; onStale: () => void };

/**
 * The one place a full BVN appears. It lives only in this mutation's state and is wiped
 * when the modal closes; every reveal is logged with its reason before the API decrypts it.
 */
function RevealModal({ open, onClose, userId, onStale }: ModalProps) {
  const reveal = useRevealBvn(userId);
  const [reason, setReason] = useState("");
  const valid = reason.trim().length >= 5;
  const bvn = reveal.data?.bvn;

  const close = () => {
    reveal.reset();
    setReason("");
    onClose();
  };

  const submit = () =>
    reveal.mutate(reason.trim(), {
      onError: (err) => {
        if (notPending(err)) {
          toast.error(err.message);
          onStale();
          close();
        }
      },
    });

  return (
    <ConfirmationModal
      open={open}
      onOpenChange={(o) => !o && close()}
      title="Reveal full BVN"
      primaryAction={
        bvn
          ? { label: "Done", onClick: close }
          : { label: reveal.isPending ? "Revealing…" : "Reveal", onClick: submit, disabled: reveal.isPending || !valid }
      }
      secondaryAction={{ label: bvn ? "Hide" : "Cancel", onClick: close }}
    >
      {bvn ? (
        <div className="space-y-3 p-2 text-sm text-grey-500">
          <p className="rounded-lg bg-grey-25 px-4 py-5 text-center font-mono text-2xl tracking-[0.2em] text-grey-800 select-all">{bvn}</p>
          <p>Compare it with the record, then close this window. It isn't stored in the back office and won't be shown again without another logged reveal.</p>
        </div>
      ) : (
        <div className="space-y-3 text-sm text-grey-500">
          <p>Every reveal is logged with your name, IP address and reason. Only pending BVNs can be revealed, up to 30 an hour.</p>
          <div className="space-y-1.5">
            <Label htmlFor="reveal-reason">Why do you need to see it?</Label>
            <Textarea id="reveal-reason" maxLength={200} placeholder="Comparing with the NIBSS record for manual review." value={reason} onChange={(e) => setReason(e.target.value)} />
            <p className="text-xs text-grey-400">At least 5 characters.</p>
          </div>
          {reveal.isError && <p className="text-sm text-destructive">{reveal.error.message}</p>}
        </div>
      )}
    </ConfirmationModal>
  );
}
