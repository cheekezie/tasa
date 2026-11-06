import { UserAvatar } from "@/shared/components/UserAvatar";
import type { ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAdminEvents } from "@/features/events/api";
import { ID_TYPE_LABELS, useSeller, type SellerDetail, type SellerSubmission } from "@/features/sellers/api";
import { SellerLogo, SuspendedBadge, VerificationBadge } from "@/features/sellers/components/badges";
import { ReviewActions, SuspensionAction } from "@/features/sellers/components/SellerActions";
import { SellerDocuments } from "@/features/sellers/components/SellerDocuments";
import { UserStatusBadge } from "@/features/users/components/badges";
import { count, date, dateTime, naira, titleCase } from "@/lib/format";
import appRoutes, { toPath } from "@/routes/appRoutes";
import BackButton from "@/shared/components/BackButton";
import { DetailPageSkeleton } from "@/shared/components/DetailPageSkeleton";
import { DetailRow } from "@/shared/components/DetailSectionCard";
import { LoadFailed, Metric, Panel } from "@/shared/components/Metric";
import StatusBadge from "@/shared/components/StatusBadge";
import { Skeleton } from "@/shared/ui/skeleton";
import { useCan } from "@/stores";

const sellerName = (s: SellerDetail) => s.organisation ?? s.user?.name ?? (s.user?.username ? `@${s.user.username}` : "This organiser");

/** One organiser: who they are, whether they're verified, whether they're suspended, and what they've put on sale. */
export default function SellerDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const query = useSeller(id);
  const seller = query.data;

  return (
    <>
      <div className="mb-6 flex items-center gap-3">
        <BackButton onClick={() => navigate(appRoutes.SELLERS)} />
        {seller && <SellerLogo url={seller.logoUrl} name={sellerName(seller)} size="lg" />}
        <div className="min-w-0">
          <h1 className="text-page-title truncate text-grey-800">{seller ? sellerName(seller) : "Organiser"}</h1>
          {seller && (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <VerificationBadge status={seller.verification.status} />
              <SuspendedBadge suspension={seller.suspension} />
              <span className="text-sm text-grey-400">Selling since {date(seller.since)}</span>
            </div>
          )}
        </div>
      </div>

      {query.isError && <LoadFailed error={query.error} onRetry={() => query.refetch()} />}
      {query.isPending && <DetailPageSkeleton sectionCount={4} documentCount={0} />}
      {seller && <SellerBody seller={seller} onStale={() => query.refetch()} />}
    </>
  );
}

const Rows = ({ children }: { children: ReactNode }) => <div className="space-y-2.5 text-sm">{children}</div>;

function SellerBody({ seller, onStale }: { seller: SellerDetail; onStale: () => void }) {
  const name = sellerName(seller);
  const { user, contact } = seller;

  return (
    <div className="space-y-6">
      {seller.suspension.active && (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <p className="font-semibold text-destructive">Suspended{seller.suspension.at ? ` since ${dateTime(seller.suspension.at)}` : ""}</p>
          <p className="mt-1 text-sm text-grey-500">
            Their events are paused, they can't create new ones and withdrawals are held. Tickets already sold, refunds and door scans still work.
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Metric label="Ticket balance" value={naira(seller.ticketBalance)} hint="Sales held for them until they withdraw" />
        <Metric label="Payout account" value={seller.bankAccount ? seller.bankAccount.bankName : "Not added"} hint={seller.bankAccount ? `•••• ${seller.bankAccount.accountNumber.slice(-4)}` : "They can't withdraw until they add one"} />
        <Metric label="Terms accepted" value={seller.termsAccepted ?? "—"} hint="Version of the seller terms" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Organisation">
          <Rows>
            <DetailRow label="Name" value={seller.organisation ?? "—"} />
            <DetailRow label="Phone" value={contact.phone ?? "—"} />
            <DetailRow label="Email" value={contact.email ?? "—"} />
            <DetailRow
              label="Website"
              value={
                contact.website ? (
                  <a href={/^https?:\/\//.test(contact.website) ? contact.website : `https://${contact.website}`} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline">
                    {contact.website}
                  </a>
                ) : (
                  "—"
                )
              }
            />
            <DetailRow label="Instagram" value={contact.instagram ? `@${contact.instagram.replace(/^@/, "")}` : "—"} />
          </Rows>
          <div className="mt-4 border-t border-grey-50 pt-4">
            <p className="mb-1 text-xs text-grey-400">About</p>
            <p className="text-sm whitespace-pre-line text-grey-700">{seller.about ?? "They haven't written anything."}</p>
          </div>
        </Panel>

        <Panel
          title="The person"
          actions={
            <Link to={toPath(appRoutes.USER, { id: seller.id })} className="text-sm font-medium text-primary hover:underline">
              Open user
            </Link>
          }
        >
          {user ? (
            <Rows>
              <div className="flex items-center gap-3 pb-1">
                <UserAvatar url={user.avatarUrl} name={user.name ?? user.username ?? "?"} size="lg" />
                <div className="min-w-0">
                  <p className="truncate font-medium text-grey-800">{user.name ?? "No name on file"}</p>
                  {user.username && <p className="truncate text-xs text-grey-400">@{user.username}</p>}
                </div>
              </div>
              <DetailRow label="Legal name" value={user.name ?? "—"} />
              <DetailRow label="Username" value={user.username ? `@${user.username}` : "—"} />
              <DetailRow label="Phone" value={user.phone ?? "—"} />
              <DetailRow label="Email" value={user.email ?? "—"} />
              <DetailRow
                label="BVN"
                value={
                  user.bvnStatus ? (
                    <span className="inline-flex items-center gap-2">
                      <StatusBadge variant={user.bvnStatus === "verified" ? "success" : user.bvnStatus === "pending" ? "warning" : "error"} label={user.bvnStatus} />
                      {user.bvnLast4 && <span className="font-mono text-xs text-grey-400">•••• {user.bvnLast4}</span>}
                    </span>
                  ) : (
                    "Not added"
                  )
                }
              />
              <DetailRow label="NIN" value={user.ninLast4 ? <span className="font-mono text-xs">•••• {user.ninLast4}</span> : "Not added"} />
              <DetailRow label="Account" value={<UserStatusBadge status={user.status} />} />
              <DetailRow label="On Tela since" value={date(user.joinedAt)} />
            </Rows>
          ) : (
            <p className="text-sm text-grey-500">The user account behind this organiser wasn't found.</p>
          )}
        </Panel>
      </div>

      <Verification seller={seller} name={name} onStale={onStale} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Suspension seller={seller} name={name} onStale={onStale} />
        <Panel title="Payout bank account">
          {seller.bankAccount ? (
            <Rows>
              <DetailRow label="Bank" value={seller.bankAccount.bankName} />
              <DetailRow label="Account number" value={<span className="font-mono">{seller.bankAccount.accountNumber}</span>} />
              <DetailRow label="Account name" value={seller.bankAccount.accountName} />
            </Rows>
          ) : (
            <p className="text-sm text-grey-500">No bank account yet. Withdrawals need one.</p>
          )}
        </Panel>
      </div>

      <SellerEvents sellerId={seller.id} />
    </div>
  );
}

/** What they sent, what was decided, and (for compliance) the documents and the decision itself. */
function Verification({ seller, name, onStale }: { seller: SellerDetail; name: string; onStale: () => void }) {
  const canReview = useCan("compliance");
  const v = seller.verification;
  const idType = v.idType ? ID_TYPE_LABELS[v.idType] : null;

  return (
    <Panel title="Verification">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,320px)_1fr]">
        <Rows>
          <DetailRow label="Status" value={<VerificationBadge status={v.status} />} />
          <DetailRow label="ID type" value={idType ?? "—"} />
          <DetailRow label="Sent" value={dateTime(v.submittedAt)} />
          <DetailRow label="Reviewed" value={dateTime(v.reviewedAt)} />
          <DetailRow label="Reviewed by" value={v.reviewedBy ?? "—"} />
          {v.reason && <DetailRow label="Rejected because" value={v.reason} />}
        </Rows>

        <div className="space-y-4">
          {v.status === "unsubmitted" && <p className="text-sm text-grey-500">They haven't sent a selfie and ID yet, so they can't create events.</p>}
          {v.status === "approved" && <p className="text-sm text-grey-500">Approved. They can create events, and their documents can no longer be replaced.</p>}
          {v.status === "rejected" && <p className="text-sm text-grey-500">Rejected. They were sent the reason and can send new documents, which puts them back in the queue.</p>}
          {v.status === "pending" && (
            <p className="text-sm text-grey-500">
              Waiting for a decision. Check the selfie matches the ID and the person on the account. They're notified either way, with your
              reason if you reject.
            </p>
          )}

          {canReview ? (
            v.hasDocuments ? (
              <SellerDocuments key={`${seller.id}-${v.submittedAt ?? ""}`} sellerId={seller.id} idTypeLabel={idType} />
            ) : (
              v.status !== "unsubmitted" && <p className="text-sm text-grey-400">No documents are stored for this organiser.</p>
            )
          ) : (
            v.hasDocuments && <p className="text-xs text-grey-400">Only compliance can see the documents.</p>
          )}

          {v.status === "pending" &&
            (canReview ? (
              <div className="border-t border-grey-50 pt-4">
                <ReviewActions seller={seller} name={name} onStale={onStale} />
              </div>
            ) : (
              <p className="text-xs text-grey-400">Only compliance can approve or reject.</p>
            ))}
        </div>
      </div>

      {v.history.length > 0 && <EarlierSubmissions sellerId={seller.id} history={v.history} canView={canReview} />}
    </Panel>
  );
}

/** What they sent before this, and what became of it, so a resubmission can be checked against the rejected one. */
function EarlierSubmissions({ sellerId, history, canView }: { sellerId: string; history: SellerSubmission[]; canView: boolean }) {
  return (
    <div className="mt-6 space-y-3 border-t border-grey-50 pt-4">
      <p className="text-xs font-semibold tracking-wide text-grey-400 uppercase">Earlier submissions ({history.length})</p>
      <ol className="space-y-3">
        {history.map((h) => {
          const idType = ID_TYPE_LABELS[h.idType];
          return (
            <li key={h.id} className="space-y-3 rounded-lg border border-grey-50 p-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                {h.status === "pending" ? <StatusBadge variant="neutral" label="Replaced before review" /> : <VerificationBadge status={h.status} />}
                <span className="text-grey-800">{idType}</span>
                <span className="text-grey-400">Sent {dateTime(h.submittedAt)}</span>
                {h.reviewedAt && (
                  <span className="text-grey-400">
                    · {h.status === "rejected" ? "Rejected" : "Reviewed"} by {h.reviewedBy ?? "a former admin"} {dateTime(h.reviewedAt)}
                  </span>
                )}
              </div>
              {h.reason && (
                <p className="text-sm text-grey-500">
                  <span className="font-medium text-grey-800">Reason: </span>
                  {h.reason}
                </p>
              )}
              {canView && h.hasDocuments && <SellerDocuments sellerId={sellerId} submission={h.id} idTypeLabel={idType} compact />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Suspension({ seller, name, onStale }: { seller: SellerDetail; name: string; onStale: () => void }) {
  const canSuspend = useCan("compliance", "support");
  const s = seller.suspension;

  return (
    <Panel title="Suspension">
      <div className="space-y-4">
        <Rows>
          <DetailRow label="Status" value={s.active ? <StatusBadge variant="error" label="Suspended" /> : <StatusBadge variant="success" label="Not suspended" />} />
          {s.active && <DetailRow label="Reason" value={s.reason ?? "—"} />}
          {s.active && <DetailRow label="By" value={s.by ?? "—"} />}
          {s.active && <DetailRow label="Since" value={dateTime(s.at)} />}
          {!s.active && s.liftedAt && <DetailRow label="Last lifted" value={dateTime(s.liftedAt)} />}
        </Rows>
        {s.history.length > 0 && (
          <div className="space-y-2 border-t border-grey-50 pt-4">
            <p className="text-xs font-semibold tracking-wide text-grey-400 uppercase">History</p>
            <ol className="space-y-2">
              {s.history.map((h) => (
                <li key={`${h.action}-${h.at}`} className="flex gap-3 text-sm">
                  <span className={`mt-1.5 size-2 shrink-0 rounded-full ${h.action === "suspended" ? "bg-destructive" : "bg-success-500"}`} />
                  <div className="min-w-0">
                    <p className="text-grey-800">
                      {h.action === "suspended" ? "Suspended" : "Lifted"} by {h.by ?? "a former admin"} · {dateTime(h.at)}
                    </p>
                    {h.reason && <p className="text-grey-500">{h.reason}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}
        <div className="flex flex-col gap-3 border-t border-grey-50 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-grey-500">
            {s.active ? "Lifting it puts back on sale exactly the events the suspension paused." : "Suspending pauses all their events and holds their withdrawals."}
          </p>
          {canSuspend ? (
            <SuspensionAction seller={seller} name={name} onStale={onStale} />
          ) : (
            <p className="shrink-0 text-xs text-grey-400">Only compliance and support can change this.</p>
          )}
        </div>
      </div>
    </Panel>
  );
}

const EVENTS_SHOWN = 10;

/** Their latest events, linking to the events page filtered to them for the rest. */
function SellerEvents({ sellerId }: { sellerId: string }) {
  const query = useAdminEvents({ owner: sellerId, page: 1, limit: EVENTS_SHOWN });
  const data = query.data;

  return (
    <Panel
      title={data ? `Events (${count(data.total)})` : "Events"}
      actions={
        <Link to={`${appRoutes.EVENTS}?owner=${sellerId}`} className="text-sm font-medium text-primary hover:underline">
          Open in events
        </Link>
      }
    >
      {query.isError && <LoadFailed error={query.error} onRetry={() => query.refetch()} />}
      {query.isPending && (
        <div className="space-y-2">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      )}
      {data && data.items.length === 0 && <p className="py-6 text-center text-sm text-grey-400">No events yet.</p>}
      {data && data.items.length > 0 && (
        <ul className="divide-y divide-grey-50">
          {data.items.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-grey-800">{e.title}</p>
                <p className="truncate text-xs text-grey-400">
                  <span className="font-mono">{e.code}</span> · {e.venue} · {dateTime(e.startsAt)}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-sm text-grey-800">
                  {count(e.sold)} sold · {naira(e.gross)}
                </span>
                <StatusBadge
                  variant={e.sales === "on_sale" ? "success" : e.sales === "ended" ? "closed" : e.adminPaused ? "error" : "warning"}
                  label={e.sales === "paused" ? (e.adminPaused ? "Paused by Tela" : "Paused") : titleCase(e.sales)}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      {data && data.total > data.items.length && (
        <p className="mt-2 text-xs text-grey-400">
          Showing the latest {count(data.items.length)} of {count(data.total)}.
        </p>
      )}
    </Panel>
  );
}
