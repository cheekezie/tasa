import { Link, useNavigate, useParams } from "react-router-dom";
import { useCoupon, useCouponAction, type AdminCouponDetail } from "@/features/coupons/api";
import { serviceLabel, statusVariant } from "@/features/coupons/money";
import { count, dateTime, naira, titleCase } from "@/lib/format";
import appRoutes, { toPath } from "@/routes/appRoutes";
import BackButton from "@/shared/components/BackButton";
import { DetailSectionCard } from "@/shared/components/DetailSectionCard";
import { LoadFailed, Metric, Panel } from "@/shared/components/Metric";
import PageHeader from "@/shared/components/PageHeader";
import StatusBadge from "@/shared/components/StatusBadge";
import { Button } from "@/shared/ui/button";
import { Skeleton } from "@/shared/ui/skeleton";
import { useCan } from "@/stores";
import { useAskAction } from "@/shared/hooks/useAskAction";

type Action = "pause" | "resume" | "close";

/** One coupon or gift: who it's for, what it has cost, and the controls to stop it. */
export default function CouponDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const query = useCoupon(id);
  const c = query.data;

  return (
    <>
      <div className="mb-4">
        <BackButton onClick={() => navigate(appRoutes.COUPONS)} />
      </div>
      {query.isError && <LoadFailed error={query.error} onRetry={() => query.refetch()} />}
      {query.isPending && (
        <div className="space-y-4">
          <Skeleton className="h-10 w-72" />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-xl" />
        </div>
      )}
      {c && <CouponView coupon={c} />}
    </>
  );
}

function CouponView({ coupon: c }: { coupon: AdminCouponDetail }) {
  const canAct = useCan("finance", "support");
  const action = useCouponAction();
  const { ask } = useAskAction();
  const isTasa = c.fundedBy === "tasa";
  const live = c.status === "active" || c.status === "paused";
  // Closing with claims keeps it active for the claimants and just stops new claims (remaining → 0).
  // A gift someone has started spending can't be closed at all.
  const closable = live && !c.closed && c.remaining > 0 && !(c.kind === "gift" && c.redeemed > 0);

  const confirm = (a: Action) =>
    ask({
      title: a === "close" ? `Close ${c.code}?` : a === "pause" ? `Pause ${c.code}?` : `Resume ${c.code}?`,
      variant: a === "close" ? "danger" : a === "pause" ? "warning" : "primary",
      confirmText: a === "close" ? "Close for good" : a === "pause" ? "Pause" : "Resume",
      description:
        a === "pause" ? (
          <p>Nobody can claim or spend it while it's paused. Balances stay as they are, and you can resume it any time before it expires.</p>
        ) : a === "resume" ? (
          <p>People can claim and spend it again until {dateTime(c.expiresAt)}.</p>
        ) : (
          <div className="space-y-2 text-left">
            <p>Closing can't be undone.</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>No one new can claim it.</li>
              {isTasa ? (
                <li>Tasa stops being exposed to unclaimed places: up to {naira(c.amount * c.remaining)} that will never be spent.</li>
              ) : (
                <li>The owner's unclaimed money, {naira(c.amount * c.remaining)}, goes back to their wallet now.</li>
              )}
              <li>
                People who already claimed keep their balance and can spend it until {dateTime(c.expiresAt)}
                {c.redeemed > 0 ? ", so it stays listed as active until then" : ""}.
                {!isTasa && " Whatever they don't spend goes back to the owner after expiry."}
              </li>
            </ul>
          </div>
        ),
      onConfirm: async () => {
        await action.mutateAsync({ id: c.id, action: a });
        return { message: a === "pause" ? "Paused. Nobody can use it until you resume." : a === "resume" ? "Resumed" : "Closed to new claims" };
      },
    });

  const actions = canAct && live
    ? [
        c.status === "active" ? (
          <Button key="pause" variant="outline" onClick={() => confirm("pause")}>
            Pause
          </Button>
        ) : (
          <Button key="resume" variant="outline" onClick={() => confirm("resume")}>
            Resume
          </Button>
        ),
        ...(closable
          ? [
              <Button key="close" variant="destructive" onClick={() => confirm("close")}>
                Close
              </Button>,
            ]
          : []),
      ]
    : [];

  return (
    <>
      <PageHeader title={c.title} subtitle={`${isTasa ? "Tasa" : "User"} ${c.kind} · code ${c.code}`} actions={actions} />

      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Claimed" value={`${count(c.redeemed)} / ${count(c.quantity)}`} hint={`${count(c.remaining)} claims left`} />
          <Metric label="Spent on bills" value={naira(c.stats.used)} hint={`${count(c.stats.uses)} bills`} />
          {isTasa ? (
            <>
              <Metric label="Cost to Tasa" value={naira(c.stats.cost)} hint={`Ceiling ${naira(c.stats.maxExposure)} (${naira(c.amount)} × ${count(c.quantity)})`} />
              <Metric label="Exposure left" value={naira(c.stats.exposureLeft)} hint="What it could still cost if every claim is spent" tone={c.stats.exposureLeft ? "default" : "good"} />
            </>
          ) : (
            <>
              <Metric label="Per person" value={naira(c.amount)} hint={`${naira(c.amount * c.quantity)} paid in by the owner`} />
              <Metric label="Left in the pool" value={naira(c.stats.poolLeft)} hint="The owner's money not yet spent or returned" />
            </>
          )}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <DetailSectionCard
            title="Details"
            rows={[
              { label: "Status", value: c.status, type: "status", variant: statusVariant(c.status) },
              ...(c.closed ? [{ label: "Closed to new claims", value: c.closedAt ? dateTime(c.closedAt) : "Yes" }] : []),
              { label: "Code", value: <span className="font-mono normal-case">{c.code}</span> },
              { label: "Kind", value: titleCase(c.kind) },
              { label: "Paid by", value: isTasa ? "Tasa" : "User" },
              ...(isTasa ? [{ label: "Created by", value: c.createdByName ?? "—" }] : []),
              { label: "Per person", value: naira(c.amount) },
              { label: "Works on", value: c.services === "all" ? "Every bill" : c.services.map(serviceLabel).join(", ") },
              { label: "Starts", value: dateTime(c.startsAt) },
              { label: "Expires", value: dateTime(c.expiresAt) },
              { label: "Created", value: dateTime(c.createdAt) },
            ]}
          />
          <div className="space-y-4">
            <DetailSectionCard
              title={c.kind === "gift" ? "Recipient" : "People"}
              rows={[
                ...(c.owner
                  ? [
                      {
                        label: "Owner",
                        value: (
                          <Link to={toPath(appRoutes.USER, { id: c.owner })} className="text-primary normal-case hover:underline">
                            {c.ownerName ?? "View user"}
                          </Link>
                        ),
                      },
                    ]
                  : []),
                ...(c.recipient
                  ? [
                      { label: "Sent to", value: <span className="normal-case">{c.recipient.label}</span> },
                      { label: "Name", value: c.recipient.name ?? "—" },
                      {
                        label: "Tasa account",
                        value: c.recipient.user ? (
                          <Link to={toPath(appRoutes.USER, { id: c.recipient.user })} className="text-primary normal-case hover:underline">
                            {c.recipient.userName ?? "View user"}
                          </Link>
                        ) : (
                          "Not joined yet (invited)"
                        ),
                      },
                    ]
                  : []),
                { label: "People who claimed", value: count(c.stats.claims) },
                { label: "Bills paid with it", value: count(c.stats.uses) },
              ]}
            />
            {(c.message || c.description) && (
              <div className="rounded-xl border border-grey-50 bg-white p-3 text-sm text-grey-500">
                {c.description && <p>{c.description}</p>}
                {c.message && <p className={c.description ? "mt-2" : ""}>“{c.message}”</p>}
              </div>
            )}
            {!live ? (
              <p className="flex items-center gap-2 text-sm text-grey-400">
                <StatusBadge variant={statusVariant(c.status)} label={c.status} /> Nothing more can be claimed.
              </p>
            ) : (
              c.closed && (
                <p className="flex items-center gap-2 text-sm text-grey-400">
                  <StatusBadge variant="closed" label="Closed" /> No new claims. People who claimed can spend what's left until it expires.
                </p>
              )
            )}
          </div>
        </div>

        <Claims claims={c.claims} />
      </div>

    </>
  );
}

/** Who claimed it and what each has left. The API sends the latest 500. */
function Claims({ claims }: { claims: AdminCouponDetail["claims"] }) {
  return (
    <Panel title={`Claims (${count(claims.length)}${claims.length >= 500 ? "+" : ""})`}>
      {claims.length === 0 ? (
        <p className="py-6 text-center text-sm text-grey-400">Nobody has claimed it yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-grey-50 text-left text-xs text-grey-400">
                <th className="py-2 pr-3 font-medium">Person</th>
                <th className="py-2 pr-3 text-right font-medium">Allowance</th>
                <th className="py-2 pr-3 text-right font-medium">Used</th>
                <th className="py-2 pr-3 text-right font-medium">Left</th>
                <th className="py-2 pr-3 text-right font-medium">Bills</th>
                <th className="py-2 font-medium">Claimed</th>
              </tr>
            </thead>
            <tbody>
              {claims.map((cl) => (
                <tr key={cl.id} className="border-b border-grey-50 last:border-0">
                  <td className="py-2.5 pr-3">
                    <Link to={toPath(appRoutes.USER, { id: cl.user })} className="font-medium text-primary hover:underline">
                      {cl.userName ?? "Unknown user"}
                    </Link>
                    {cl.username && cl.userName !== `@${cl.username}` && <span className="ml-1.5 text-xs text-grey-400">@{cl.username}</span>}
                  </td>
                  <td className="py-2.5 pr-3 text-right whitespace-nowrap">{naira(cl.allowance)}</td>
                  <td className="py-2.5 pr-3 text-right whitespace-nowrap">{naira(cl.used)}</td>
                  <td className="py-2.5 pr-3 text-right whitespace-nowrap">{naira(cl.left)}</td>
                  <td className="py-2.5 pr-3 text-right">{count(cl.uses)}</td>
                  <td className="py-2.5 whitespace-nowrap text-grey-500">{dateTime(cl.claimedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
