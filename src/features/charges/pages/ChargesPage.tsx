import { useState } from "react";
import { CHARGE_SCOPES, SCOPE_LABELS, useChargeRules, useDeleteChargeRule, type ChargeRule } from "@/features/charges/api";
import { ChargePreviewPanel } from "@/features/charges/components/ChargePreviewPanel";
import { ChargeRuleDialog } from "@/features/charges/components/ChargeRuleDialog";
import { bpsToPercent, describeRule, specificity, SPECIFICITY_LABELS } from "@/features/charges/rules";
import { serviceLabel } from "@/features/coupons/money";
import { dateTime, naira } from "@/lib/format";
import { cn } from "@/lib/utils";
import { LoadFailed, Panel } from "@/shared/components/Metric";
import PageHeader from "@/shared/components/PageHeader";
import { RowActionsMenu } from "@/shared/components/RowActionsMenu";
import StatusBadge from "@/shared/components/StatusBadge";
import { Button } from "@/shared/ui/button";
import { Skeleton } from "@/shared/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/ui/table";
import { useCan } from "@/stores";
import { useAskAction } from "@/shared/hooks/useAskAction";

/** Every charge Tela adds to a transaction, grouped by what it's charged on. */
export default function ChargesPage() {
  const canEdit = useCan("finance");
  const query = useChargeRules();
  const remove = useDeleteChargeRule();
  const [editing, setEditing] = useState<{ rule: ChargeRule | null } | null>(null);
  const { ask } = useAskAction();

  /** Deleting is final, so it's confirmed with what the rule was and what takes over after. */
  const confirmDelete = (rule: ChargeRule) =>
    ask({
      title: "Delete this charge rule?",
      variant: "danger",
      confirmText: "Delete rule",
      description: (
        <div className="space-y-2">
          <p>
            <span className="font-medium text-grey-800">{rule.label}</span> on {SCOPE_LABELS[rule.scope].toLowerCase()}
            {rule.serviceId && ` · ${serviceLabel(rule.serviceId)}`}
            {rule.provider && ` · ${rule.provider}`} ({rule.active ? describeRule(rule) : "currently off"}).
          </p>
          <p>
            {specificity(rule) > 0
              ? "Once it's gone, the broader rule for this code applies here instead. If you only want to stop charging here, switch it off rather than deleting it."
              : "Once it's gone, this charge stops wherever no more specific rule covers it."}
          </p>
        </div>
      ),
      onConfirm: async () => {
        await remove.mutateAsync(rule.id);
        return { message: "Charge rule deleted" };
      },
    });

  // Scope order from the API's list; within a scope, broad rules first so overrides read top-down.
  const groups = CHARGE_SCOPES.map((scope) => ({
    scope,
    rules: (query.data ?? [])
      .filter((r) => r.scope === scope)
      .sort(
        (a, b) =>
          (a.serviceId ?? "").localeCompare(b.serviceId ?? "") ||
          specificity(a) - specificity(b) ||
          (a.provider ?? "").localeCompare(b.provider ?? "") ||
          a.code.localeCompare(b.code),
      ),
  })).filter((g) => g.rules.length > 0);

  return (
    <>
      <PageHeader
        title="Charges"
        subtitle="What Tela charges on each kind of transaction. Changes reach new quotes within 30 seconds."
        actions={
          canEdit
            ? [
                <Button key="new" onClick={() => setEditing({ rule: null })}>
                  New rule
                </Button>,
              ]
            : []
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-6">
          {query.isError && <LoadFailed error={query.error} onRetry={() => query.refetch()} />}
          {query.isPending && Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-48 rounded-xl" />)}
          {query.data && groups.length === 0 && (
            <Panel>
              <p className="py-8 text-center text-sm text-grey-400">No charge rules yet. Every transaction is free until you add one.</p>
            </Panel>
          )}
          {groups.map((g) => (
            <Panel key={g.scope} title={`${SCOPE_LABELS[g.scope]} · ${g.scope}`} className="overflow-hidden">
              <div className="-m-4 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Applies to</TableHead>
                      <TableHead>Code / label</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="text-right">Fixed</TableHead>
                      <TableHead className="text-right">Min</TableHead>
                      <TableHead className="text-right">Max</TableHead>
                      <TableHead>Active</TableHead>
                      {canEdit && <TableHead />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {g.rules.map((r) => (
                      <TableRow key={r.id} className={cn(!r.active && "text-grey-400")}>
                        <TableCell>
                          <div className={cn(specificity(r) === 1 && "pl-3", specificity(r) >= 2 && "pl-6")}>
                            <p className="text-grey-800">
                              {r.serviceId ? serviceLabel(r.serviceId) : "Everything"}
                              {r.provider && <span className="font-mono"> · {r.provider}</span>}
                            </p>
                            <p className="text-xs text-grey-400">{SPECIFICITY_LABELS[specificity(r)]}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <p className="font-mono text-xs text-grey-400">{r.code}</p>
                          <p title={`Updated ${dateTime(r.updatedAt)}`}>{r.label}</p>
                        </TableCell>
                        <TableCell className="text-right">{r.rateBps ? bpsToPercent(r.rateBps) : "—"}</TableCell>
                        <TableCell className="text-right">{r.fixed ? naira(r.fixed) : "—"}</TableCell>
                        <TableCell className="text-right">{r.min ? naira(r.min) : "—"}</TableCell>
                        <TableCell className="text-right">{r.max != null ? naira(r.max) : "No cap"}</TableCell>
                        <TableCell>
                          {r.active ? (
                            <StatusBadge variant="success" label="On" />
                          ) : (
                            <span title={r.serviceId ? "Switches this charge off here, overriding broader rules" : undefined}>
                              <StatusBadge variant="inactive" label={r.serviceId ? "Off here" : "Off"} />
                            </span>
                          )}
                        </TableCell>
                        {canEdit && (
                          <TableCell>
                            <RowActionsMenu
                              actions={[
                                { label: "Edit", onClick: () => setEditing({ rule: r }) },
                                { label: "Delete", variant: "destructive", onClick: () => confirmDelete(r) },
                              ]}
                            />
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Panel>
          ))}
        </div>

        <div className="space-y-6">
          <ChargePreviewPanel />
          <Panel title="Which rule applies">
            <div className="space-y-2 text-sm text-grey-500">
              <p>For each code, the most specific rule wins:</p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>scope + service + provider</li>
                <li>scope + service</li>
                <li>scope alone</li>
              </ol>
              <p>
                An <span className="font-medium text-grey-800">inactive</span> specific rule still wins, so it switches the charge off for that service or
                provider, for example free airtime while other bills still pay.
              </p>
              <p>Rules with different codes add up. A charge is never refunded unless its bill is.</p>
            </div>
          </Panel>
        </div>
      </div>

      <ChargeRuleDialog open={editing !== null} rule={editing?.rule ?? null} onOpenChange={(open) => !open && setEditing(null)} />

    </>
  );
}
