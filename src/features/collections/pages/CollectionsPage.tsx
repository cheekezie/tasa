import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useCollect, type CollectResult } from "@/features/collections/api";
import { dateTime, naira } from "@/lib/format";
import { cn } from "@/lib/utils";
import appRoutes, { toPath } from "@/routes/appRoutes";
import { Panel } from "@/shared/components/Metric";
import PageHeader from "@/shared/components/PageHeader";
import StatusBadge, { type StatusVariant } from "@/shared/components/StatusBadge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

type Attempt = { reference: string; at: string } & ({ ok: true; result: CollectResult } | { ok: false; error: string });

const OUTCOMES: Record<CollectResult["status"], { label: string; variant: StatusVariant; tone: string; explain: string }> = {
  credited: {
    label: "Credited",
    variant: "success",
    tone: "border-success-500/30 bg-success-500/5",
    explain: "SaySwitch confirmed the payment. The money is now in the user's wallet and they've been notified.",
  },
  already_credited: {
    label: "Already credited",
    variant: "info",
    tone: "border-grey-50 bg-grey-25",
    explain: "This transfer was credited before, so nothing changed. If the user still says it's missing, check the transaction below.",
  },
  not_paid: {
    label: "Not paid",
    variant: "warning",
    tone: "border-[#F59E0B]/30 bg-[#FFFBEB]",
    explain:
      "SaySwitch doesn't report this reference as a successful payment. Check the reference against the SaySwitch dashboard, or try again later if the transfer is still settling.",
  },
  unmatched: {
    label: "No matching account",
    variant: "error",
    tone: "border-destructive/20 bg-destructive/5",
    explain:
      "SaySwitch says it was paid, but not into any Tasa permanent account. Nothing was credited. Escalate to finance with the reference and customer code.",
  },
};

/** For a user whose bank transfer into their permanent account never showed up. */
export default function CollectionsPage() {
  const collect = useCollect();
  const [reference, setReference] = useState("");
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const trimmed = reference.trim();
  const valid = trimmed.length >= 4 && trimmed.length <= 64;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid || collect.isPending) return;
    const ref = trimmed;
    const at = new Date().toISOString();
    collect.mutate(ref, {
      onSuccess: (result) => {
        setAttempts((prev) => [{ reference: ref, at, ok: true as const, result }, ...prev]);
        if (result.status === "credited" || result.status === "already_credited") setReference("");
      },
      onError: (error) => setAttempts((prev) => [{ reference: ref, at, ok: false as const, error: error.message }, ...prev]),
    });
  };

  return (
    <>
      <PageHeader
        title="Missed collections"
        subtitle="Credit a transfer into a user's permanent account when the SaySwitch webhook never arrived."
      />
      <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
        <Panel title="Credit a transfer">
          <form onSubmit={submit} className="space-y-4">
            <ol className="list-decimal space-y-1 pl-4 text-sm text-grey-500">
              <li>Get the session ID or amount and time from the user's bank receipt.</li>
              <li>Find the transfer in the SaySwitch dashboard and copy its reference.</li>
              <li>Paste it here. SaySwitch is asked again and decides whose account it was.</li>
            </ol>
            <div className="space-y-1.5">
              <Label htmlFor="collection-reference">SaySwitch reference</Label>
              <Input
                id="collection-reference"
                autoComplete="off"
                className="font-mono"
                placeholder="Reference from the SaySwitch dashboard"
                maxLength={64}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
              <p className="text-xs text-grey-400">It can only ever be credited once, so checking the same reference twice is safe.</p>
            </div>
            <Button type="submit" className="w-full" disabled={!valid || collect.isPending}>
              {collect.isPending ? "Checking with SaySwitch…" : "Check and credit"}
            </Button>
          </form>
        </Panel>

        <Panel title="Results">
          {attempts.length === 0 ? (
            <p className="py-8 text-center text-sm text-grey-400">Results for the references you check appear here. They're cleared when you leave the page.</p>
          ) : (
            <ul className="space-y-3">
              {attempts.map((a, i) => (
                <AttemptCard key={`${a.at}-${i}`} attempt={a} />
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}

function AttemptCard({ attempt }: { attempt: Attempt }) {
  if (!attempt.ok) {
    return (
      <li className="rounded-lg border border-destructive/20 bg-destructive/5 p-4">
        <Header reference={attempt.reference} at={attempt.at} badge={<StatusBadge variant="error" label="Didn't go through" />} />
        <p className="mt-2 text-sm text-grey-600">{attempt.error}</p>
        <p className="mt-1 text-xs text-grey-400">Nothing was credited. Try again in a moment.</p>
      </li>
    );
  }

  const { result } = attempt;
  const outcome = OUTCOMES[result.status];
  return (
    <li className={cn("rounded-lg border p-4", outcome.tone)}>
      <Header reference={attempt.reference} at={attempt.at} badge={<StatusBadge variant={outcome.variant} label={outcome.label} />} />
      <p className="mt-2 text-sm text-grey-600">{outcome.explain}</p>

      {(result.status === "credited" || result.status === "already_credited") && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-white/70 px-3 py-2 text-sm">
          <span className="font-medium text-grey-800">{naira(result.transaction.amount)} to the wallet</span>
          {result.transaction.fee > 0 && <span className="text-grey-400">{naira(result.transaction.fee)} charges</span>}
          <span className="text-grey-400">{result.transaction.subtitle}</span>
          <Link to={toPath(appRoutes.TRANSACTION, { id: result.transaction.id })} className="font-mono text-xs text-primary hover:underline">
            {result.transaction.reference}
          </Link>
          {result.status === "credited" && (
            <Link to={toPath(appRoutes.USER, { id: result.userId })} className="text-primary hover:underline">
              View user
            </Link>
          )}
        </div>
      )}

      {result.status === "unmatched" && (
        <p className="mt-2 text-sm text-grey-600">
          SaySwitch customer code: <span className="font-mono text-xs">{result.customerCode ?? "not given"}</span>
        </p>
      )}
    </li>
  );
}

function Header({ reference, at, badge }: { reference: string; at: string; badge: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="font-mono text-sm text-grey-800">{reference}</span>
      <div className="flex items-center gap-2">
        <span className="text-xs text-grey-400">{dateTime(at)}</span>
        {badge}
      </div>
    </div>
  );
}
