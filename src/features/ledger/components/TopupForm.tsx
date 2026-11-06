import { useState, type FormEvent } from "react";
import { useRecordTopup, type TopupInput } from "@/features/ledger/api";
import { naira, toKobo } from "@/lib/format";
import { Panel } from "@/shared/components/Metric";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Textarea } from "@/shared/ui/textarea";
import { useAskAction } from "@/shared/hooks/useAskAction";

const SOURCES: Record<TopupInput["from"], { label: string; hint: string }> = {
  sayswitch: { label: "From our SaySwitch balance", hint: "Moves the amount from provider:sayswitch to provider:vtpass on the books." },
  external: { label: "From outside (opening balance)", hint: "Books it against equity:opening. Use for money that didn't come from SaySwitch." },
};

/**
 * Records a VTpass top-up already made in the providers' dashboards. One idempotency key per
 * top-up: it survives retries and errors, so a resubmit after a timeout can't book it twice,
 * and only changes once a top-up is recorded.
 */
export function TopupForm() {
  const record = useRecordTopup();
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [amount, setAmount] = useState("");
  const [from, setFrom] = useState<TopupInput["from"]>("sayswitch");
  const [note, setNote] = useState("");
  const [fee, setFee] = useState("");
  const { ask } = useAskAction();

  const typed = Number(amount);
  const kobo = Number.isFinite(typed) ? toKobo(typed) : 0;
  const amountOk = amount.trim() !== "" && kobo > 0;
  const noteOk = note.trim().length >= 5 && note.trim().length <= 200;
  // Moving money out of SaySwitch costs a transfer fee: it's a real cost, and it leaves our SaySwitch balance too.
  const feeKobo = from === "sayswitch" && fee.trim() !== "" && Number.isFinite(Number(fee)) ? toKobo(Number(fee)) : 0;
  const feeOk = feeKobo >= 0 && feeKobo <= 1_000_000;

  const review = (e: FormEvent) => {
    e.preventDefault();
    if (!(amountOk && noteOk && feeOk)) return;
    ask({
      title: "Record this top-up?",
      confirmText: `Record ${naira(kobo)}`,
      description: (
        <div className="space-y-2">
          <p>
            Adds <span className="font-medium text-grey-800">{naira(kobo)}</span> to the VTpass balance on Tela's books,{" "}
            {from === "sayswitch" ? "taken from the SaySwitch balance" : "as an opening balance from outside"}.
          </p>
          {feeKobo > 0 && (
            <p>
              SaySwitch's <span className="font-medium text-grey-800">{naira(feeKobo)}</span> fee comes off the SaySwitch balance too, and shows as a
              cost in the P&amp;L.
            </p>
          )}
          <p>Only confirm if the money has actually reached the VTpass wallet. Postings can't be edited, only corrected with a new one.</p>
        </div>
      ),
      // The key stays the same on a retry, so trying again from the dialog can't book it twice.
      onConfirm: async () => {
        const result = await record.mutateAsync({ amount: kobo, from, ...(feeKobo > 0 ? { fee: feeKobo } : {}), note: note.trim(), idempotencyKey: key });
        setAmount("");
        setNote("");
        setFee("");
        setFrom("sayswitch");
        setKey(crypto.randomUUID());
        record.reset();
        return {
          message: result.duplicate
            ? "This top-up was already recorded, so nothing new was posted. The books are up to date."
            : `Recorded a ${naira(kobo)} VTpass top-up. Books now show ${naira(result.books)}.`,
        };
      },
    });
  };

  return (
    <Panel title="Record a VTpass top-up">
      <form onSubmit={review} className="space-y-4">
        <p className="text-sm text-grey-500">
          Make the transfer in the SaySwitch and VTpass dashboards first. This only updates Tela's books to match; it doesn't move money.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="topup-amount">Amount (₦)</Label>
          <Input
            id="topup-amount"
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            placeholder="500000"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          {amountOk && <p className="text-xs text-grey-400">{naira(kobo)}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="topup-from">Paid from</Label>
          <Select value={from} onValueChange={(v) => setFrom(v as TopupInput["from"])}>
            <SelectTrigger id="topup-from">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SOURCES) as TopupInput["from"][]).map((s) => (
                <SelectItem key={s} value={s}>
                  {SOURCES[s].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-grey-400">{SOURCES[from].hint}</p>
        </div>
        {from === "sayswitch" && (
          <div className="space-y-1.5">
            <Label htmlFor="topup-fee">SaySwitch's transfer fee (₦)</Label>
            <Input
              id="topup-fee"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="0"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
            />
            <p className="text-xs text-grey-400">From the SaySwitch dashboard. Booked as a cost in the P&amp;L, so our SaySwitch balance stays right.</p>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="topup-note">Note</Label>
          <Textarea
            id="topup-note"
            maxLength={200}
            placeholder="SaySwitch transfer ref, date, who approved it"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <p className="text-xs text-grey-400">5 to 200 characters. Saved on the ledger posting.</p>
        </div>
        {record.isError && (
          <div className="rounded-lg bg-destructive/5 p-3 text-sm">
            <p className="text-destructive">{record.error.message}</p>
            <p className="mt-1 text-xs text-grey-500">
              It may or may not have been recorded. Submitting again is safe: if it already went through, it won't be booked twice.
            </p>
          </div>
        )}
        <Button type="submit" className="w-full" disabled={!amountOk || !noteOk || !feeOk || record.isPending}>
          {record.isError ? "Try again" : "Review top-up"}
        </Button>
      </form>

    </Panel>
  );
}
