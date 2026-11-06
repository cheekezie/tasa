import { useLedgerSummary, useVtpassBalance, type LedgerSummary } from "@/features/ledger/api";
import { TopupForm } from "@/features/ledger/components/TopupForm";
import { naira } from "@/lib/format";
import { cn } from "@/lib/utils";
import { LoadFailed, Metric, Panel } from "@/shared/components/Metric";
import PageHeader from "@/shared/components/PageHeader";
import { Skeleton } from "@/shared/ui/skeleton";

/** Plain words for each account group, and what its sign normally is. */
const GROUPS: { key: keyof LedgerSummary; label: string; meaning: string }[] = [
  { key: "provider:sayswitch", label: "SaySwitch balance", meaning: "Money held at SaySwitch. Should match the SaySwitch dashboard." },
  { key: "provider:vtpass", label: "VTpass wallet", meaning: "Prepaid VTpass balance for bills. Compared with VTpass above." },
  { key: "bills:in_flight", label: "Bills in flight", meaning: "Taken from wallets for bills VTpass hasn't settled yet." },
  { key: "payouts:in_flight", label: "Payouts in flight", meaning: "Organisers' withdrawals sent to SaySwitch that haven't reached their bank yet." },
  { key: "wallet:*", label: "User wallets", meaning: "Owed to users: every wallet balance. Negative is normal." },
  { key: "tickets:*", label: "Organisers' ticket balances", meaning: "Ticket sales owed to organisers until they withdraw. Negative is normal." },
  { key: "coupon:*", label: "Giveaway pools", meaning: "Owed to giveaway and gift holders until claimed or refunded." },
  { key: "revenue:*", label: "Revenue", meaning: "Charges and commission earned, all time. Negative is normal." },
  { key: "expense:*", label: "Expenses", meaning: "Absorbed fees, promotions, giveaways and points, all time." },
  { key: "equity:*", label: "Equity", meaning: "Opening balances put in from outside." },
  { key: "liability:*", label: "Other liabilities", meaning: "Balances forfeited by closed accounts, held as owed." },
];

/** The books at a glance, whether VTpass agrees with them, and where to record a top-up. */
export default function LedgerPage() {
  return (
    <>
      <PageHeader title="Ledger" subtitle="Tela's books, checked against VTpass. Profit and loss lives in the P&L report." />
      <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
        <div className="min-w-0 space-y-6">
          <VtpassCheck />
          <Summary />
        </div>
        <TopupForm />
      </div>
    </>
  );
}

/** A gap means a top-up wasn't recorded here, or VTpass spent money on a vend we don't know about. */
function VtpassCheck() {
  const query = useVtpassBalance();
  const data = query.data;

  return (
    <Panel title="VTpass balance vs our books">
      {query.isError && <LoadFailed error={query.error} onRetry={() => query.refetch()} />}
      {query.isPending && (
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      )}
      {data && data.vtpass === null && (
        <div className="space-y-3">
          <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
            <p className="font-medium text-grey-800">VTpass didn't answer</p>
            <p className="mt-1 text-grey-500">
              We couldn't get the live balance, so there's nothing to compare yet{data.vtpassError ? ` (${data.vtpassError})` : ""}. Our books are below;
              try again in a minute.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Metric label="VTpass says" value="—" hint="No answer from VTpass" />
            <Metric label="Our books say" value={naira(data.books)} hint="provider:vtpass" />
            <Metric label="Difference" value="—" hint="Needs VTpass's balance" />
          </div>
          <CheckAgain fetching={query.isFetching} onClick={() => query.refetch()} />
        </div>
      )}
      {data && data.vtpass !== null && data.difference !== null && (
        <div className="space-y-3">
          <div className="grid gap-4 sm:grid-cols-3">
            <Metric label="VTpass says" value={naira(data.vtpass)} hint="Live from VTpass" />
            <Metric label="Our books say" value={naira(data.books)} hint="provider:vtpass" />
            <Metric
              label="Difference"
              value={naira(data.difference)}
              tone={data.difference === 0 ? "good" : "bad"}
              hint={data.difference === 0 ? "In step" : data.difference > 0 ? "VTpass has more than we booked" : "VTpass has less than we booked"}
            />
          </div>
          {data.difference > 0 && (
            <p className="text-sm text-grey-500">
              Usually a top-up that hasn't been recorded yet. If you topped up VTpass, record it with the form.
            </p>
          )}
          {data.difference < 0 && (
            <p className="text-sm text-grey-500">
              VTpass spent money our books don't show, or a recorded top-up never arrived. Check recent VTpass transactions against bills here,
              starting with any that need review.
            </p>
          )}
          <CheckAgain fetching={query.isFetching} onClick={() => query.refetch()} />
        </div>
      )}
    </Panel>
  );
}

const CheckAgain = ({ fetching, onClick }: { fetching: boolean; onClick: () => void }) => (
  <button type="button" onClick={onClick} disabled={fetching} className="text-sm font-medium text-primary hover:underline disabled:opacity-50">
    {fetching ? "Checking…" : "Check again"}
  </button>
);

function Summary() {
  const query = useLedgerSummary();
  const data = query.data;
  // Every posting nets to zero, so the groups should too. Anything left over is an account root this page doesn't know yet.
  const rest = data ? -GROUPS.reduce((s, g) => s + (data[g.key] ?? 0), 0) : 0;

  return (
    <Panel title="Balance sheet">
      {query.isError && <LoadFailed error={query.error} onRetry={() => query.refetch()} />}
      {query.isPending && <Skeleton className="h-80 rounded-lg" />}
      {data && (
        <div className="space-y-3">
          <p className="text-xs text-grey-400">Raw ledger signs: what Tela holds is +, what Tela owes or has earned is −.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-grey-50 text-left text-xs text-grey-400">
                  <th className="py-2 pr-3 font-medium">Account</th>
                  <th className="py-2 pr-3 text-right font-medium">Balance</th>
                  <th className="hidden py-2 font-medium md:table-cell">What it is</th>
                </tr>
              </thead>
              <tbody>
                {GROUPS.map((g) => (
                  <Row key={g.key} label={g.label} account={g.key} amount={data[g.key] ?? 0} meaning={g.meaning} />
                ))}
                {rest !== 0 && (
                  <Row
                    label="Unlisted accounts"
                    account="worked out as the remainder"
                    amount={rest}
                    meaning="The groups above don't net to zero, so the API is reporting an account root this page doesn't list. Tell engineering."
                  />
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Panel>
  );
}

function Row({ label, account, amount, meaning }: { label: string; account: string; amount: number; meaning: string }) {
  return (
    <tr className="border-b border-grey-50 last:border-0 align-top">
      <td className="py-2.5 pr-3">
        <p className="text-grey-800">{label}</p>
        <p className="font-mono text-xs text-grey-400">{account}</p>
      </td>
      <td className={cn("py-2.5 pr-3 text-right font-medium whitespace-nowrap", amount < 0 ? "text-grey-800" : amount > 0 ? "text-success-500" : "text-grey-300")}>
        {amount > 0 ? "+" : ""}
        {naira(amount)}
      </td>
      <td className="hidden py-2.5 text-xs text-grey-500 md:table-cell">{meaning}</td>
    </tr>
  );
}
