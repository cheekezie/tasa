import { useState } from "react";
import { CHARGE_SCOPES, SCOPE_LABELS, useChargePreview, type ChargeScope, type PreviewParams } from "@/features/charges/api";
import { FormField, NairaInput } from "@/features/coupons/components/FormBits";
import { koboFromInput, SERVICE_IDS, SERVICE_LABELS } from "@/features/coupons/money";
import { naira } from "@/lib/format";
import { Panel } from "@/shared/components/Metric";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Skeleton } from "@/shared/ui/skeleton";

const ANY = "any";

/** "What would a ₦10,000 electricity bill cost right now?", priced by the API with the live rules. */
export function ChargePreviewPanel() {
  const [scope, setScope] = useState<ChargeScope>("bill");
  const [serviceId, setServiceId] = useState<string>("electricity");
  const [provider, setProvider] = useState("");
  const [amount, setAmount] = useState("10000");
  const [params, setParams] = useState<PreviewParams | null>(null);
  const [error, setError] = useState<string | undefined>();
  const preview = useChargePreview(params);

  const price = () => {
    const kobo = koboFromInput(amount);
    if (!kobo) {
      setError("Enter an amount in naira");
      return;
    }
    setError(undefined);
    setParams({
      scope,
      amount: kobo,
      ...(serviceId !== ANY ? { serviceId } : {}),
      ...(provider.trim() ? { provider: provider.trim().toUpperCase() } : {}),
    });
  };

  return (
    <Panel title="Try a price">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          price();
        }}
      >
        <FormField label="Scope">
          <Select value={scope} onValueChange={(v) => setScope(v as ChargeScope)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHARGE_SCOPES.map((s) => (
                <SelectItem key={s} value={s}>
                  {SCOPE_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Service">
            <Select value={serviceId} onValueChange={setServiceId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>None</SelectItem>
                {SERVICE_IDS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {SERVICE_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField id="pv-provider" label="Provider">
            <Input id="pv-provider" value={provider} placeholder="Any" onChange={(e) => setProvider(e.target.value.toUpperCase())} />
          </FormField>
        </div>
        <FormField id="pv-amount" label="Amount" error={error ?? (preview.error ? preview.error.message : undefined)}>
          <NairaInput id="pv-amount" value={amount} error={!!error} onChange={setAmount} />
        </FormField>
        <Button type="submit" className="w-full" disabled={preview.isFetching}>
          {preview.isFetching ? "Pricing…" : "Price it"}
        </Button>
      </form>

      {params && preview.isPending && preview.isFetching && <Skeleton className="mt-4 h-24 rounded-lg" />}
      {preview.data && (
        <div className="mt-4 space-y-1.5 rounded-lg bg-grey-25 p-3 text-sm">
          <Line label="Amount" value={naira(preview.data.amount)} />
          {preview.data.charges.length === 0 ? (
            <p className="text-grey-400">No charges apply.</p>
          ) : (
            preview.data.charges.map((c) => <Line key={c.code} label={c.label} value={naira(c.amount)} hint={c.code} />)
          )}
          <div className="border-t border-grey-100 pt-1.5">
            <Line label="User pays" value={naira(preview.data.total)} strong />
          </div>
        </div>
      )}
    </Panel>
  );
}

function Line({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-grey-500">
        {label}
        {hint && <span className="ml-1 font-mono text-xs text-grey-300">{hint}</span>}
      </span>
      <span className={strong ? "font-semibold text-grey-800" : "text-grey-800"}>{value}</span>
    </div>
  );
}
