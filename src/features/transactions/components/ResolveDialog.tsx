import { useState } from "react";
import { toast } from "sonner";
import { useResolve, type TransactionDetail } from "@/features/transactions/api";
import { naira, nairaForInput, toKobo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ConfirmationModal } from "@/shared/components/ConfirmationModal";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Textarea } from "@/shared/ui/textarea";

type Outcome = "delivered" | "failed";

/** What each outcome does to the money, in the words finance needs before confirming. */
function consequence(tx: TransactionDetail, outcome: Outcome, cost: number | null) {
  if (tx.kind === "group_payout") {
    return outcome === "delivered"
      ? `Marks the withdrawal as received by the group's bank. The ${naira(tx.amount)} leaves Tela's SaySwitch balance for good.`
      : `The withdrawal never left, so ${naira(tx.total)} (charge included) goes back to the group's balance and its executives can withdraw again.`;
  }
  if (tx.kind === "ticket_payout") {
    return outcome === "delivered"
      ? `Marks the payout as received by the bank. The ${naira(tx.amount)} leaves Tela's SaySwitch balance for good and the seller is told it's paid.`
      : `The payout never left, so ${naira(tx.total)} (charge included) goes back to the seller's ticket wallet and they can withdraw again.`;
  }
  return outcome === "delivered"
    ? cost !== null
      ? `Settles the bill as delivered. The user's ${naira(tx.total)} stays spent, ${naira(cost)} is booked as paid to VTpass and the ${naira(tx.amount - cost)} difference as our commission.`
      : `Settles the bill as delivered. The user's ${naira(tx.total)} stays spent and the full ${naira(tx.amount)} is booked as paid to VTpass, so no commission is recorded. Enter what VTpass kept to book it.`
    : `Refunds ${naira(tx.total)} to the user's wallet (charges included${tx.discount > 0 ? `, and the ${naira(tx.discount)} giveaway discount goes back to its giveaway` : ""}). Only choose this if VTpass confirms nothing was delivered.`;
}

/** Final word on a stuck bill or ticket payout. Can't be undone, so it spells out where the money goes. */
export function ResolveDialog({ tx, open, onOpenChange }: { tx: TransactionDetail; open: boolean; onOpenChange: (open: boolean) => void }) {
  const resolve = useResolve(tx.id);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [token, setToken] = useState("");
  const [note, setNote] = useState("");
  const [costInput, setCostInput] = useState("");
  const isBill = tx.kind === "bill";
  const checkWith = isBill ? "VTpass" : "SaySwitch";
  const noteOk = note.trim().length >= 5;
  // What VTpass kept, in kobo: above zero and no more than the face value (the rest is our commission).
  const askCost = isBill && outcome === "delivered";
  const costKobo = costInput.trim() ? toKobo(Number(costInput)) : null;
  const costError =
    askCost && costInput.trim()
      ? !Number.isFinite(costKobo) || costKobo === null || costKobo <= 0
        ? "Enter an amount above ₦0"
        : costKobo > tx.amount
          ? `Can't be more than the bill's ${naira(tx.amount)}`
          : null
      : null;
  const cost = askCost && !costError ? costKobo : null;

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setOutcome(null);
      setToken("");
      setNote("");
      setCostInput("");
      resolve.reset();
    }
  };

  const submit = () => {
    if (!outcome || !noteOk || costError) return;
    resolve.mutate(
      {
        outcome,
        note: note.trim(),
        ...(askCost && token.trim() ? { token: token.trim() } : {}),
        ...(cost !== null ? { cost } : {}),
      },
      {
        onSuccess: () => {
          toast.success(outcome === "delivered" ? `${tx.reference} marked delivered` : `${tx.reference} marked failed and refunded`);
          close(false);
        },
      },
    );
  };

  const options: { value: Outcome; title: string; hint: string }[] = [
    { value: "delivered", title: isBill ? "Delivered" : "Paid out", hint: isBill ? "VTpass confirms the user got it" : "The bank received the money" },
    { value: "failed", title: "Failed", hint: isBill ? "VTpass confirms it never went through" : "The money never left SaySwitch" },
  ];

  return (
    <ConfirmationModal
      open={open}
      onOpenChange={close}
      title={`Resolve ${isBill ? "bill" : "payout"} ${tx.reference}`}
      primaryAction={{
        label: resolve.isPending ? "Resolving…" : outcome === "failed" ? "Mark failed and refund" : "Mark delivered",
        variant: outcome === "failed" ? "destructive" : "default",
        onClick: submit,
        disabled: !outcome || !noteOk || !!costError || resolve.isPending,
      }}
      secondaryAction={{ label: "Cancel", closeOnClick: true }}
    >
      <div className="space-y-4 p-2 text-sm text-grey-500">
        <p>
          Check the {checkWith} dashboard first. This is final: the {isBill ? "bill" : "payout"} stops waiting on {checkWith} and the money
          moves straight away.
        </p>

        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Outcome">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={outcome === o.value}
              onClick={() => setOutcome(o.value)}
              className={cn(
                "rounded-lg border px-4 py-3 text-left transition-colors",
                outcome === o.value
                  ? o.value === "failed"
                    ? "border-destructive bg-destructive/5"
                    : "border-primary bg-primary/5"
                  : "border-grey-100 hover:bg-grey-25",
              )}
            >
              <p className="font-medium text-grey-800">{o.title}</p>
              <p className="mt-0.5 text-xs text-grey-400">{o.hint}</p>
            </button>
          ))}
        </div>

        {outcome && (
          <p className={cn("rounded-lg p-3", outcome === "failed" ? "bg-destructive/5 text-destructive" : "bg-grey-25 text-grey-600")}>
            {consequence(tx, outcome, cost)}
          </p>
        )}

        {isBill && outcome === "delivered" && (
          <div className="space-y-1.5">
            <Label htmlFor="resolve-token">Token or PIN from VTpass (optional)</Label>
            <Input id="resolve-token" placeholder="e.g. 1234-5678-9012-3456-7890" value={token} onChange={(e) => setToken(e.target.value)} />
            <p className="text-xs text-grey-400">Saved on the bill so the user can see it in the app.</p>
          </div>
        )}

        {askCost && (
          <div className="space-y-1.5">
            <Label htmlFor="resolve-cost">What VTpass kept (₦, optional)</Label>
            <Input
              id="resolve-cost"
              inputMode="decimal"
              placeholder={`Up to ${nairaForInput(tx.amount)}`}
              value={costInput}
              onChange={(e) => setCostInput(e.target.value.replace(/[^\d.]/g, ""))}
              aria-invalid={!!costError}
            />
            {costError ? (
              <p className="text-xs text-destructive">{costError}</p>
            ) : (
              <p className="text-xs text-grey-400">
                The transaction's total amount on the VTpass dashboard. Our commission is booked from it; leave it blank and none is.
              </p>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="resolve-note">Note for the record</Label>
          <Textarea
            id="resolve-note"
            maxLength={300}
            placeholder={`What ${checkWith} said, and where you checked`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <p className="text-xs text-grey-400">At least 5 characters. Saved on the transaction's timeline with your admin ID.</p>
        </div>

        {resolve.isError && <p className="text-destructive">{resolve.error.message}</p>}
      </div>
    </ConfirmationModal>
  );
}
