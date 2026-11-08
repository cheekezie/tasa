import type { ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PERIOD_LABELS, useGroup, useSetGroupSuspension, type GroupDetail, type GroupPayoutChange } from "@/features/groups/api";
import { count, dateTime, naira } from "@/lib/format";
import { ApiError } from "@/lib/http";
import appRoutes from "@/routes/appRoutes";
import BackButton from "@/shared/components/BackButton";
import { DetailPageSkeleton } from "@/shared/components/DetailPageSkeleton";
import { DetailRow } from "@/shared/components/DetailSectionCard";
import { LoadFailed, Metric, Panel } from "@/shared/components/Metric";
import StatusBadge from "@/shared/components/StatusBadge";
import { useAskAction } from "@/shared/hooks/useAskAction";
import { Button } from "@/shared/ui/button";
import { useCan } from "@/stores";

const MIN_REASON = 5;

const CHANGE_STATUS: Record<GroupPayoutChange["status"], { label: string; variant: "warning" | "info" | "success" | "error" | "inactive" }> = {
  awaiting_approval: { label: "Waiting for co-signers", variant: "warning" },
  cooling_off: { label: "Cooling off", variant: "info" },
  applied: { label: "Applied", variant: "success" },
  rejected: { label: "Stopped", variant: "error" },
  expired: { label: "Lapsed", variant: "inactive" },
};

const account = (a: { accountName: string; bankName: string; accountNumber: string }) => `${a.accountName} · ${a.bankName} ${a.accountNumber}`;
const Rows = ({ children }: { children: ReactNode }) => <div className="space-y-2.5 text-sm">{children}</div>;

/** One group for the back office: its money, who runs it, how its payout account has changed, and suspending it. */
export default function GroupDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const query = useGroup(id);
  const group = query.data;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start gap-3">
        <BackButton onClick={() => navigate(appRoutes.GROUPS)} />
        {group && (
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-heading text-2xl font-semibold text-grey-800">{group.name}</h1>
              {group.suspension.active && <StatusBadge variant="error" label="Suspended" />}
            </div>
            <p className="text-sm text-grey-400">
              Started {dateTime(group.createdAt)} · invite code <span className="font-mono">{group.inviteCode}</span>
            </p>
          </div>
        )}
      </div>
      {query.isError && <LoadFailed error={query.error} onRetry={() => query.refetch()} />}
      {query.isPending && <DetailPageSkeleton sectionCount={4} documentCount={0} />}
      {group && <GroupBody group={group} onStale={() => query.refetch()} />}
    </>
  );
}

function GroupBody({ group, onStale }: { group: GroupDetail; onStale: () => void }) {
  return (
    <div className="space-y-6">
      {group.suspension.active && (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <p className="font-semibold text-destructive">Suspended{group.suspension.at ? ` since ${dateTime(group.suspension.at)}` : ""}</p>
          <p className="mt-1 text-sm text-grey-500">
            Nobody can join or pay dues, withdrawals are held and the payout account can't change. The money stays the group's.
            {group.suspension.reason && ` Reason: ${group.suspension.reason}`}
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Metric label="Holding" value={naira(group.balance)} hint="Dues held for the group until its executives withdraw" />
        <Metric label="Collected" value={naira(group.collected.amount)} hint={`${count(group.collected.payments)} dues payments`} />
        <Metric label="Members" value={count(group.members.active)} hint={`${count(group.members.pending)} waiting · ${count(group.members.removed)} removed`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Payout account">
          <Rows>
            <DetailRow label="Account name" value={group.payout.accountName} />
            <DetailRow label="Bank" value={group.payout.bankName} />
            <DetailRow label="Account number" value={<span className="font-mono">{group.payout.accountNumber}</span>} />
            <DetailRow label="Terms version" value={String(group.termsVersion)} />
          </Rows>
          <p className="mt-4 text-xs text-grey-400">Members accepted this account when they joined. Withdrawals can only go here.</p>
        </Panel>

        <Panel title="Dues and members">
          <Rows>
            {group.dues.map((d) => (
              <DetailRow
                key={d.id}
                label={d.name}
                value={[
                  d.period ? `${naira(d.amount)} ${PERIOD_LABELS[d.period]}` : `${naira(d.amount)} once`,
                  d.compulsory ? "compulsory" : "optional",
                  d.dueAt && `due ${dateTime(d.dueAt)}`,
                  d.endedAt && `ended ${dateTime(d.endedAt)}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
            ))}
            <DetailRow label="Joining" value={group.requireApproval ? "Executives approve each member" : "Anyone with the code"} />
            <DetailRow label="Asks members" value={group.fields.length ? group.fields.map((f) => f.label).join(", ") : "Nothing"} />
          </Rows>
          {group.about && <p className="mt-4 border-t border-grey-50 pt-4 text-sm whitespace-pre-line text-grey-700">{group.about}</p>}
        </Panel>
      </div>

      <Panel title="Executives">
        <ul className="divide-y divide-grey-50 text-sm">
          {group.executives.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 truncate text-grey-800">
                {e.name ?? "—"}
                {e.username && <span className="text-grey-400"> · @{e.username}</span>}
              </span>
              <span className="shrink-0 text-xs text-grey-400">
                {e.role === "owner" ? "Owner" : "Executive"} · since {dateTime(e.addedAt)}
              </span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Payout account changes">
        {group.payoutChanges.length === 0 ? (
          <p className="text-sm text-grey-500">The payout account has never been changed.</p>
        ) : (
          <ol className="space-y-4">
            {group.payoutChanges.map((c) => (
              <li key={c.id} className="space-y-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge variant={CHANGE_STATUS[c.status].variant} label={CHANGE_STATUS[c.status].label} />
                  <span className="text-grey-400">
                    Proposed by {c.proposedBy ?? "—"} · {dateTime(c.createdAt)}
                  </span>
                </div>
                <p className="text-grey-800">
                  {account(c.from)} → {account(c.to)}
                </p>
                <p className="text-xs text-grey-500">
                  Co-signers: {c.cosigners.map((x) => `${x.name ?? "—"} ${x.approvedAt ? `(approved ${dateTime(x.approvedAt)})` : "(not yet)"}`).join(", ")}
                </p>
                {c.effectiveAt && <p className="text-xs text-grey-500">Takes effect {dateTime(c.effectiveAt)}</p>}
                {c.closedReason && (
                  <p className="text-xs text-grey-500">
                    Stopped by {c.closedBy ?? "—"}: {c.closedReason}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <Panel title="Withdrawals">
        {group.withdrawals.length === 0 ? (
          <p className="text-sm text-grey-500">Nothing withdrawn yet.</p>
        ) : (
          <ul className="divide-y divide-grey-50 text-sm">
            {group.withdrawals.map((w) => (
              <li key={w.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block text-grey-800 tabular-nums">
                    {naira(w.amount)} <span className="text-xs text-grey-400">+ {naira(w.fee)} fee</span>
                  </span>
                  <span className="block truncate text-xs text-grey-400">
                    {w.to ? account(w.to) : "—"} · {w.by ?? "—"} · {dateTime(w.at)} · <span className="font-mono">{w.reference}</span>
                  </span>
                </span>
                <StatusBadge
                  variant={w.status === "success" ? "success" : w.status === "failed" ? "error" : "warning"}
                  label={w.status === "success" ? "Sent" : w.status === "failed" ? "Returned" : "Pending"}
                />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Suspension group={group} onStale={onStale} />
    </div>
  );
}

function Suspension({ group, onStale }: { group: GroupDetail; onStale: () => void }) {
  const canSuspend = useCan("compliance", "support");
  const setSuspension = useSetGroupSuspension(group.id);
  const { ask } = useAskAction();
  const s = group.suspension;
  const onError = (err: unknown) => {
    if (err instanceof ApiError && err.code === "SUSPENSION_UNCHANGED") onStale();
  };

  const suspend = () =>
    ask({
      title: `Suspend ${group.name}?`,
      variant: "danger",
      confirmText: "Suspend",
      description: (
        <ul className="list-disc space-y-1 pl-5 text-left">
          <li>Nobody can join or pay dues.</li>
          <li>Withdrawals are held, and the payout account can't change. A change already cooling off waits until you lift this.</li>
          <li>The money stays the group's. Its executives are told, with your reason.</li>
        </ul>
      ),
      input: {
        label: `Reason (executives see this, at least ${MIN_REASON} characters)`,
        placeholder: "Members reported this isn't the real association.",
        required: true,
        variant: "textarea",
        minLength: MIN_REASON,
        maxLength: 300,
      },
      onConfirm: async ({ inputValue = "" }) => {
        await setSuspension.mutateAsync({ suspended: true, reason: inputValue });
        return { message: `${group.name} is suspended.` };
      },
      onError,
    });

  const lift = () =>
    ask({
      title: `Lift ${group.name}'s suspension?`,
      variant: "primary",
      confirmText: "Lift suspension",
      description: <p>Members can join and pay again, and executives can withdraw. They're told.</p>,
      input: { label: "Why (optional, kept in the history)", placeholder: "Confirmed with the school.", variant: "textarea", maxLength: 300 },
      onConfirm: async ({ inputValue }) => {
        await setSuspension.mutateAsync({ suspended: false, ...(inputValue ? { reason: inputValue } : {}) });
        return { message: `Suspension lifted for ${group.name}.` };
      },
      onError,
    });

  return (
    <Panel title="Suspension">
      <div className="space-y-4">
        <Rows>
          <DetailRow label="Status" value={s.active ? <StatusBadge variant="error" label="Suspended" /> : <StatusBadge variant="success" label="Not suspended" />} />
          {s.active && <DetailRow label="Reason" value={s.reason ?? "—"} />}
          {s.active && <DetailRow label="By" value={s.by ?? "—"} />}
        </Rows>
        {s.history.length > 0 && (
          <ol className="space-y-2 border-t border-grey-50 pt-4">
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
        )}
        <div className="flex justify-end border-t border-grey-50 pt-4">
          {canSuspend ? (
            <Button variant={s.active ? "default" : "destructive"} onClick={s.active ? lift : suspend}>
              {s.active ? "Lift suspension" : "Suspend group"}
            </Button>
          ) : (
            <p className="text-xs text-grey-400">Only compliance and support can change this.</p>
          )}
        </div>
      </div>
    </Panel>
  );
}
