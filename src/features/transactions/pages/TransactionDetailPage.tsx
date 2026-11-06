import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { useRequery, useTransaction, type GuestOrderInfo, type LedgerLine, type TransactionDetail, type TransactionEvent } from "@/features/transactions/api";
import { ResolveDialog } from "@/features/transactions/components/ResolveDialog";
import { KIND_LABELS, STATUS_VARIANTS } from "@/features/transactions/labels";
import { count, dateTime, naira, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import appRoutes, { toPath } from "@/routes/appRoutes";
import BackButton from "@/shared/components/BackButton";
import { DetailSectionCard, type DetailRowItem } from "@/shared/components/DetailSectionCard";
import { DetailPageSkeleton } from "@/shared/components/DetailPageSkeleton";
import { LoadFailed, Panel } from "@/shared/components/Metric";
import StatusBadge from "@/shared/components/StatusBadge";
import { Button } from "@/shared/ui/button";
import { useCan } from "@/stores";

/** DetailSectionCard capitalises values; references, tokens and provider messages must stay as written. */
const raw = (value: ReactNode, mono = false) => <span className={cn("normal-case", mono && "font-mono text-xs")}>{value}</span>;

/** Drops rows with nothing to show, so optional sections stay short. */
const rows = (items: (DetailRowItem | false | "" | null | undefined)[]) => items.filter((r): r is DetailRowItem => !!r);

/** One transaction in full: what the user saw, what the provider said, and every ledger line it caused. */
export default function TransactionDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const query = useTransaction(id);
  const tx = query.data;

  return (
    <>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <BackButton onClick={() => navigate(appRoutes.TRANSACTIONS)} />
          <div>
            <h1 className="text-page-title font-mono text-grey-800">{tx?.reference ?? "Transaction"}</h1>
            {tx && (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-body text-grey-400">{tx.title}</span>
                <StatusBadge variant={STATUS_VARIANTS[tx.status]} label={tx.status} />
                {tx.needsReview && <StatusBadge variant="error" label="Needs review" />}
              </div>
            )}
          </div>
        </div>
        {tx && <Actions tx={tx} />}
      </div>

      {query.isError && <LoadFailed error={query.error} onRetry={() => query.refetch()} />}
      {query.isPending && <DetailPageSkeleton sectionCount={4} documentCount={0} />}
      {tx && <Body tx={tx} />}
    </>
  );
}

/** Requery for any pending bill; Resolve for a pending bill or ticket payout. Hidden from roles the API would refuse. */
function Actions({ tx }: { tx: TransactionDetail }) {
  const canRequery = useCan("finance", "support");
  const canResolve = useCan("finance");
  const requery = useRequery(tx.id);
  const [resolving, setResolving] = useState(false);
  const pending = tx.status === "pending";
  const showRequery = canRequery && pending && tx.kind === "bill";
  const showResolve = canResolve && pending && (tx.kind === "bill" || tx.kind === "ticket_payout" || tx.kind === "group_payout");
  if (!showRequery && !showResolve) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {showRequery && (
        <Button
          variant="outline"
          disabled={requery.isPending}
          onClick={() =>
            requery.mutate(undefined, {
              onSuccess: (next) =>
                next.status === "pending"
                  ? toast.info("VTpass still has no final answer. Automatic checks have stopped; resolve it once you've confirmed with VTpass.")
                  : toast.success(`VTpass says it ${next.status === "success" ? "was delivered" : next.status}. The money has moved accordingly.`),
              onError: (error) => toast.error(error.message),
            })
          }
        >
          {requery.isPending ? "Asking VTpass…" : "Requery VTpass"}
        </Button>
      )}
      {showResolve && <Button onClick={() => setResolving(true)}>Resolve</Button>}
      {showResolve && <ResolveDialog tx={tx} open={resolving} onOpenChange={setResolving} />}
    </div>
  );
}

function Body({ tx }: { tx: TransactionDetail }) {
  const bill = tx.bill;
  const pd = tx.providerData;
  const hasProviderData = !!pd && Object.values(pd).some((v) => v !== undefined && v !== null && v !== "");

  return (
    <div className="space-y-6">
      {tx.needsReview && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-grey-600">
          <p className="font-medium text-destructive">The provider never gave a final answer</p>
          <p className="mt-1">
            The money is held until someone resolves it. Check the {tx.kind === "ticket_payout" || tx.kind === "group_payout" ? "SaySwitch" : "VTpass"} dashboard for{" "}
            <span className="font-mono">{pd?.requestId ?? pd?.reference ?? tx.reference}</span>, then resolve it here.
          </p>
        </div>
      )}

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DetailSectionCard
          title="Summary"
          rows={rows([
            { label: "Kind", value: KIND_LABELS[tx.kind] },
            { label: "Direction", value: tx.direction === "credit" ? "Credit (money in)" : "Debit (money out)" },
            { label: "Description", value: raw(tx.subtitle || "—") },
            {
              label: "User",
              value: (
                <Link to={toPath(appRoutes.USER, { id: tx.user })} className="text-primary hover:underline">
                  View user
                </Link>
              ),
            },
            { label: "Created", value: dateTime(tx.date) },
            { label: "Completed", value: dateTime(tx.completedAt) },
            tx.kind === "bill" && { label: "Vend attempts", value: count(tx.vendAttempts) },
          ])}
        />
        <DetailSectionCard
          title="Money"
          rows={rows([
            { label: "Amount", value: naira(tx.amount) },
            ...tx.charges.map((c) => ({ label: c.label, value: naira(c.amount) })),
            tx.charges.length === 0 && tx.fee > 0 && { label: "Charges", value: naira(tx.fee) },
            tx.discount > 0 && { label: tx.coupon ? `Discount (${tx.coupon.code})` : "Discount", value: `−${naira(tx.discount)}` },
            { label: tx.direction === "credit" && tx.funding ? "Received" : "Total", value: naira(tx.total), valueClassName: "font-semibold text-grey-800" },
          ])}
        />

        {bill && (
          <DetailSectionCard
            title="Bill"
            rows={rows([
              { label: "Service", value: raw(`${bill.provider} ${titleCase(tx.serviceId ?? "")}`) },
              { label: "Account / number", value: raw(bill.account, true) },
              bill.product && { label: "Product", value: bill.product },
              bill.meterType && { label: "Meter type", value: bill.meterType },
              bill.planName && { label: "Plan", value: raw(`${bill.planName}${bill.planCode ? ` (${bill.planCode})` : ""}`) },
              bill.customerName && { label: "Customer name", value: bill.customerName },
              { label: "Token", value: bill.token ? raw(bill.token, true) : "—" },
              bill.units && { label: "Units", value: raw(bill.units) },
              ...(bill.pins ?? []).map((p, i) => ({
                label: `PIN ${i + 1}`,
                value: raw(`${p.pin}${p.serial ? ` · serial ${p.serial}` : ""}`, true),
              })),
            ])}
          />
        )}

        {hasProviderData && pd && (
          <DetailSectionCard
            title={tx.kind === "bill" ? "VTpass" : "Provider"}
            rows={rows([
              pd.requestId && { label: "Our request ID", value: raw(pd.requestId, true) },
              pd.transactionId && { label: "Their transaction ID", value: raw(pd.transactionId, true) },
              pd.reference && { label: "Provider reference", value: raw(pd.reference, true) },
              pd.code && { label: "Response code", value: raw(pd.code, true) },
              pd.message && { label: "Message", value: raw(pd.message) },
              pd.cost !== undefined && pd.cost !== null && { label: "Cost to Tela", value: naira(pd.cost) },
              pd.sentAt && { label: "Sent", value: dateTime(pd.sentAt) },
              pd.lastCheckedAt && { label: "Last checked", value: dateTime(pd.lastCheckedAt) },
            ])}
          />
        )}

        {tx.funding && (
          <DetailSectionCard
            title="Funding account"
            rows={rows([
              { label: "Bank", value: tx.funding.bankName },
              { label: "Account number", value: raw(tx.funding.accountNumber, true) },
              { label: "Account name", value: raw(tx.funding.accountName) },
              { label: "Amount received", value: naira(tx.funding.amountReceived) },
              { label: "Account expires", value: dateTime(tx.funding.expiresAt) },
            ])}
          />
        )}

        {tx.guestOrder && <WebsiteOrder order={tx.guestOrder} currentId={tx.id} />}

        {(tx.counterparty || tx.giftTo || tx.coupon) && (
          <DetailSectionCard
            title="Other party"
            rows={rows([
              tx.counterparty?.username && { label: "Username", value: raw(`@${tx.counterparty.username}`) },
              tx.counterparty?.name && { label: "Name", value: tx.counterparty.name },
              tx.giftTo && { label: "Gift for", value: raw(tx.giftTo.name ? `${tx.giftTo.name} (${tx.giftTo.recipient})` : tx.giftTo.recipient) },
              tx.giftTo?.message && { label: "Gift message", value: raw(`“${tx.giftTo.message}”`) },
              tx.coupon && { label: titleCase(tx.coupon.kind), value: raw(tx.coupon.code, true) },
            ])}
          />
        )}
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[2fr_3fr]">
        <Panel title="Timeline">
          <Timeline events={tx.events} />
        </Panel>
        <Panel title="Ledger lines">
          <LedgerLines lines={tx.ledger} />
        </Panel>
      </section>
    </div>
  );
}

const EVENT_DOT: Record<string, string> = {
  success: "bg-success-500",
  delivered: "bg-success-500",
  paid_out: "bg-success-500",
  failed: "bg-destructive",
  awaiting_provider: "bg-[#F59E0B]",
};

/** What happened to the transaction, oldest first, as the API recorded it. */
const ORDER_STATUS: Record<GuestOrderInfo["status"], string> = {
  awaiting_payment: "Waiting for the transfer",
  paying: "Paying the bill",
  delivered: "Delivered",
  failed: "Didn't go through",
};

/**
 * Paid on the website without the app: the buyer's contact details, what the order was for and
 * how it ended. It has two transactions, the transfer (funding) and the bill; this links the other.
 */
function WebsiteOrder({ order, currentId }: { order: GuestOrderInfo; currentId: string }) {
  const other = currentId === order.fundingTransactionId ? order.billTransactionId : order.fundingTransactionId;
  return (
    <DetailSectionCard
      title="Website order (no app)"
      rows={rows([
        { label: "Order", value: raw(order.reference, true) },
        { label: "Status", value: ORDER_STATUS[order.status] },
        order.failureReason && { label: "Why", value: raw(order.failureReason) },
        { label: "Phone", value: raw(order.phone, true) },
        order.email && { label: "Email", value: raw(order.email) },
        { label: "For", value: raw([order.bill.planName ?? order.bill.provider, order.bill.account, order.bill.customerName].filter(Boolean).join(" · ")) },
        { label: "Total asked", value: naira(order.total) },
        order.payAttempts > 1 && { label: "Tries at the bill", value: count(order.payAttempts) },
        { label: "Placed", value: dateTime(order.createdAt) },
        other && {
          label: currentId === order.fundingTransactionId ? "Its bill" : "Its transfer",
          value: (
            <Link to={toPath(appRoutes.TRANSACTION, { id: other })} className="text-primary hover:underline">
              Open
            </Link>
          ),
        },
      ])}
    />
  );
}

function Timeline({ events }: { events: TransactionEvent[] }) {
  if (events.length === 0) return <p className="text-sm text-grey-400">No events recorded.</p>;
  return (
    <ol className="space-y-4">
      {events.map((e, i) => (
        <li key={`${e.type}-${e.at}-${i}`} className="relative flex gap-3">
          <div className="flex flex-col items-center">
            <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", EVENT_DOT[e.type] ?? "bg-grey-300")} />
            {i < events.length - 1 && <span className="mt-1 w-px flex-1 bg-grey-50" />}
          </div>
          <div className="min-w-0 pb-1">
            <p className="text-sm font-medium text-grey-800">{titleCase(e.type)}</p>
            <p className="text-xs text-grey-400">{dateTime(e.at)}</p>
            {e.note && <p className="mt-1 text-sm break-words text-grey-500">{e.note}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Lines grouped by posting. Each posting must net to zero; a non-zero one is flagged, since that would mean broken books. */
function LedgerLines({ lines }: { lines: LedgerLine[] }) {
  if (lines.length === 0) return <p className="text-sm text-grey-400">Nothing posted to the ledger for this transaction yet.</p>;

  const postings = new Map<string, LedgerLine[]>();
  for (const line of lines) postings.set(line.posting, [...(postings.get(line.posting) ?? []), line]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-grey-400">Signed: what Tela holds is +, what Tela owes (like a user's wallet) is −.</p>
      {[...postings.entries()].map(([posting, group]) => {
        const net = group.reduce((s, l) => s + l.amount, 0);
        return (
          <div key={posting} className="overflow-x-auto rounded-lg border border-grey-50">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-grey-50 bg-grey-25 px-3 py-2">
              <div className="min-w-0">
                <p className="font-mono text-xs text-grey-600">{posting}</p>
                <p className="text-xs text-grey-400">
                  {group[0]?.memo} · {dateTime(group[0]?.at)}
                </p>
              </div>
              {net !== 0 && <StatusBadge variant="error" label={`Off by ${naira(net)}`} />}
            </div>
            <table className="w-full text-sm">
              <tbody>
                {group.map((l, i) => (
                  <tr key={`${l.account}-${i}`} className="border-b border-grey-50 last:border-0">
                    <td className="px-3 py-2 font-mono text-xs text-grey-600">{l.account}</td>
                    <td className={cn("px-3 py-2 text-right whitespace-nowrap", l.amount < 0 ? "text-grey-800" : "text-success-500")}>
                      {l.amount > 0 ? "+" : ""}
                      {naira(l.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
