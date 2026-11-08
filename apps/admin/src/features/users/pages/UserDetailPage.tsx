import { UserAvatar } from "@/shared/components/UserAvatar";
import { useUserPoints } from "@/features/points/api";
import type { ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useSetUserStatus, useUser, useUserActivity, type UserDetail } from "@/features/users/api";
import { BvnActions } from "@/features/users/components/BvnActions";
import { BvnBadge, UserStatusBadge } from "@/features/users/components/badges";
import { userName } from "@/features/users/userName";
import { ApiError } from "@/lib/http";
import { count, dateTime, naira, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import appRoutes, { toPath } from "@/routes/appRoutes";
import BackButton from "@/shared/components/BackButton";
import { DetailPageSkeleton } from "@/shared/components/DetailPageSkeleton";
import { DetailRow } from "@/shared/components/DetailSectionCard";
import { LoadFailed, Metric, Panel } from "@/shared/components/Metric";
import StatusBadge, { type StatusVariant } from "@/shared/components/StatusBadge";
import { Button } from "@/shared/ui/button";
import { Skeleton } from "@/shared/ui/skeleton";
import { useCan } from "@/stores";
import { useAskAction } from "@/shared/hooks/useAskAction";

/** One user: who they are, whether their wallet agrees with the books, and what staff can do about their account. */
export default function UserDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const query = useUser(id);
  const user = query.data;

  return (
    <>
      <div className="mb-6 flex items-center gap-3">
        <BackButton onClick={() => navigate(appRoutes.USERS)} />
        {user && <UserAvatar url={user.avatarUrl} name={userName(user)} size="lg" />}
        <div className="min-w-0">
          <h1 className="text-page-title truncate text-grey-800">{user ? userName(user) : "User"}</h1>
          {user && (
            <div className="mt-1 flex items-center gap-2">
              <UserStatusBadge status={user.status} />
              {user.username && user.fullName && <span className="text-sm text-grey-400">@{user.username}</span>}
            </div>
          )}
        </div>
      </div>

      {query.isError && <LoadFailed error={query.error} onRetry={() => query.refetch()} />}
      {query.isPending && <DetailPageSkeleton sectionCount={2} documentCount={0} />}
      {user && <UserBody user={user} onStale={() => query.refetch()} />}
    </>
  );
}

function UserBody({ user, onStale }: { user: UserDetail; onStale: () => void }) {
  const canBvn = useCan("compliance");
  const { wallet } = user;

  return (
    <div className="space-y-6">
      {!wallet.matches && (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <p className="font-semibold text-destructive">Wallet and ledger disagree by {naira(Math.abs(wallet.cached - wallet.ledger))}</p>
          <p className="mt-1 text-sm text-grey-500">
            The wallet shows {naira(wallet.cached)} but the ledger postings add up to {naira(wallet.ledger)}. The ledger is the source of truth.
            Escalate to finance before this user moves more money.
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Metric label="Wallet balance" value={naira(wallet.cached)} hint="What the app shows them" />
        <Metric label="Ledger balance" value={naira(wallet.ledger)} hint="Sum of their wallet postings" />
        <Metric
          label="Books check"
          value={wallet.matches ? "Matches" : "Mismatch"}
          tone={wallet.matches ? "good" : "bad"}
          hint={wallet.matches ? "Wallet and ledger agree" : `Off by ${naira(wallet.cached - wallet.ledger)}`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Profile">
          <Rows>
            <DetailRow label="Legal name" value={user.fullName ?? "—"} />
            <DetailRow label="Username" value={user.username ? `@${user.username}` : "—"} />
            <DetailRow label="Phone" value={user.phone ?? "—"} />
            <DetailRow label="Email" value={user.email ?? "—"} />
            <DetailRow label="Joined" value={dateTime(user.createdAt)} />
            <DetailRow label="Transaction PIN" value={user.hasPin ? "Set" : "Not set"} />
            <DetailRow label="PIN for bills" value={user.billPinEnabled ? "Required" : "Skipped (their choice, until next sign-in)"} />
            <DetailRow label="Payday" value={user.payday ? `Day ${user.payday} of the month` : "—"} />
          </Rows>
        </Panel>

        <Panel title="Identity">
          <Rows>
            <DetailRow label="BVN" value={<BvnBadge bvn={user.bvn} />} />
            {user.bvn?.rejectionReason && <DetailRow label="Rejected because" value={user.bvn.rejectionReason} />}
            <DetailRow label="NIN" value={user.nin ? <span className="font-mono text-xs">•••• {user.nin.last4}</span> : "Not added"} />
          </Rows>
          {user.bvn?.status === "pending" && (
            <div className="mt-4 space-y-3 border-t border-grey-50 pt-4">
              <p className="text-sm text-grey-500">This BVN is waiting for a manual decision. The user is notified either way.</p>
              {canBvn ? (
                <BvnActions userId={user.id} currentName={user.fullName} onStale={onStale} />
              ) : (
                <p className="text-xs text-grey-400">Only compliance can decide a BVN.</p>
              )}
            </div>
          )}
        </Panel>
      </div>

      <AccountStatus user={user} onStale={onStale} />
      <UserPointsPanel userId={user.id} />
      <RecentActivity userId={user.id} />
    </div>
  );
}

const POINTS_TYPE: Record<string, string> = { earn: "Earned", redeem: "Converted to cash", forfeit: "Forfeited" };

/** Their points: what they hold, what it's worth, and the last few moves. */
function UserPointsPanel({ userId }: { userId: string }) {
  const query = useUserPoints(userId);
  const data = query.data;
  return (
    <Panel
      title="Points"
      actions={
        <Link to={appRoutes.POINTS_USERS} className="text-sm font-medium text-primary hover:underline">
          Everyone's points
        </Link>
      }
    >
      {query.isError && <LoadFailed error={query.error} onRetry={() => query.refetch()} />}
      {query.isPending && <Skeleton className="h-24 rounded-lg" />}
      {data && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label="Points" value={count(data.balance)} hint={data.active ? undefined : "Points are switched off"} />
            <Metric label="Worth now" value={naira(data.value)} hint={`${naira(data.pointValue)} a point`} />
            <Metric label="Earned ever" value={count(data.lifetimeEarned)} />
          </div>
          {data.history.items.length === 0 ? (
            <p className="py-3 text-center text-sm text-grey-400">No points yet.</p>
          ) : (
            <ul className="divide-y divide-grey-50">
              {data.history.items.map((e) => {
                const body = (
                  <>
                    <div className="min-w-0">
                      <p className="text-sm text-grey-800">{POINTS_TYPE[e.type] ?? titleCase(e.type)}</p>
                      <p className="truncate text-xs text-grey-400">
                        {e.transaction ? `${e.transaction.title} · ${e.transaction.reference}` : "No transaction"} · {dateTime(e.date)}
                      </p>
                    </div>
                    <span className={cn("shrink-0 text-sm font-medium tabular-nums", e.points >= 0 ? "text-success-500" : "text-grey-800")}>
                      {e.points >= 0 ? "+" : "−"}
                      {count(Math.abs(e.points))}
                    </span>
                  </>
                );
                return (
                  <li key={e.id}>
                    {e.transaction ? (
                      <Link to={toPath(appRoutes.TRANSACTION, { id: e.transaction.id })} className="flex items-center justify-between gap-4 py-2.5 hover:bg-grey-25">
                        {body}
                      </Link>
                    ) : (
                      <div className="flex items-center justify-between gap-4 py-2.5">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {data.history.total > data.history.items.length && (
            <p className="text-xs text-grey-400">Showing the latest {data.history.items.length} of {count(data.history.total)} moves.</p>
          )}
        </div>
      )}
    </Panel>
  );
}

const Rows = ({ children }: { children: ReactNode }) => <div className="space-y-2.5 text-sm">{children}</div>;

/** Suspend or reactivate. Closing is the user's own decision and is final. */
function AccountStatus({ user, onStale }: { user: UserDetail; onStale: () => void }) {
  const canEdit = useCan("support");
  const setStatus = useSetUserStatus(user.id);
  const { ask } = useAskAction();
  const next = user.status === "active" ? "suspended" : "active";

  const confirm = () =>
    ask({
      title: next === "suspended" ? "Suspend this account?" : "Reactivate this account?",
      variant: next === "suspended" ? "danger" : "primary",
      confirmText: next === "suspended" ? "Suspend" : "Reactivate",
      description:
        next === "suspended" ? (
          <div className="space-y-2 text-left">
            <p>{userName(user)} is signed out on every device at once, and every debit is refused until you reactivate them:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>bill payments, transfers, gifts and giveaways</li>
              <li>scheduled recurring bills and auto-pay</li>
            </ul>
          </div>
        ) : (
          <p>{userName(user)} can sign in and pay again straight away, and their recurring bills and auto-pay are no longer blocked.</p>
        ),
      onConfirm: async () => {
        await setStatus.mutateAsync(next);
        return { message: next === "suspended" ? "Account suspended. They've been signed out." : "Account reactivated" };
      },
      // They closed it meanwhile: show the page as it is now.
      onError: (err) => err instanceof ApiError && err.code === "ACCOUNT_CLOSED" && onStale(),
    });

  return (
    <Panel title="Account status">
      {user.status === "closed" ? (
        <p className="text-sm text-grey-500">The user closed this account. Closed accounts can't be reactivated; their financial records are kept.</p>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-grey-500">
            {user.status === "active"
              ? "Suspending signs them out everywhere and blocks every debit straight away, including recurring bills and auto-pay."
              : "Suspended: signed out, and every debit is blocked. Reactivating lets them sign in and pay again."}
          </p>
          {canEdit ? (
            <Button
              className="shrink-0"
              variant={next === "suspended" ? "destructive" : "default"}
              disabled={setStatus.isPending}
              onClick={confirm}
            >
              {next === "suspended" ? "Suspend account" : "Reactivate account"}
            </Button>
          ) : (
            <p className="shrink-0 text-xs text-grey-400">Only support can change this.</p>
          )}
        </div>
      )}
    </Panel>
  );
}

const TX_VARIANT: Record<string, StatusVariant> = { success: "success", pending: "warning", failed: "error", expired: "inactive", reversed: "neutral" };

/** Their ten latest transactions, linking to the full record. */
function RecentActivity({ userId }: { userId: string }) {
  const query = useUserActivity(userId);
  const items = query.data?.items;

  return (
    <Panel
      title="Recent activity"
      actions={
        <Link to={`${appRoutes.TRANSACTIONS}?user=${userId}`} className="text-sm font-medium text-primary hover:underline">
          See all
        </Link>
      }
    >
      {query.isError && <LoadFailed error={query.error} onRetry={() => query.refetch()} />}
      {query.isPending && (
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      )}
      {items && items.length === 0 && <p className="py-6 text-center text-sm text-grey-400">No transactions yet.</p>}
      {items && items.length > 0 && (
        <ul className="divide-y divide-grey-50">
          {items.map((tx) => (
            <li key={tx.id}>
              <Link to={toPath(appRoutes.TRANSACTION, { id: tx.id })} className="flex items-center justify-between gap-4 py-3 hover:bg-grey-25">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-grey-800">{tx.title}</p>
                  <p className="truncate text-xs text-grey-400">
                    {titleCase(tx.kind)} · {tx.reference} · {dateTime(tx.date)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className={cn("text-sm font-medium", tx.direction === "credit" ? "text-success-500" : "text-grey-800")}>
                    {tx.direction === "credit" ? "+" : "−"}
                    {naira(tx.total)}
                  </span>
                  <span className="flex items-center gap-1">
                    {tx.needsReview && <StatusBadge variant="error" label="Needs review" />}
                    <StatusBadge variant={TX_VARIANT[tx.status] ?? "neutral"} label={tx.status} />
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
