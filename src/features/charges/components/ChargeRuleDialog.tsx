import { useState } from "react";
import { toast } from "sonner";
import {
  CHARGE_SCOPES,
  SCOPE_LABELS,
  useCreateChargeRule,
  useUpdateChargeRule,
  type ChargeRule,
  type ChargeScope,
} from "@/features/charges/api";
import { describeRule, percentToBps } from "@/features/charges/rules";
import { FormField, NairaInput } from "@/features/coupons/components/FormBits";
import { fieldErrors, inputFromKobo, koboFromInput, SERVICE_IDS, SERVICE_LABELS, serviceLabel } from "@/features/coupons/money";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Switch } from "@/shared/ui/switch";

const ANY = "any";

/** Create (no `rule`) or edit a charge rule. Where a rule applies can't change after it's made. */
export function ChargeRuleDialog({ open, rule, onOpenChange }: { open: boolean; rule: ChargeRule | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        {open && <RuleForm key={rule?.id ?? "new"} rule={rule} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function RuleForm({ rule, onDone }: { rule: ChargeRule | null; onDone: () => void }) {
  const create = useCreateChargeRule();
  const update = useUpdateChargeRule();
  const mutation = rule ? update : create;

  const [scope, setScope] = useState<ChargeScope>(rule?.scope ?? "bill");
  const [serviceId, setServiceId] = useState<string>(rule?.serviceId ?? ANY);
  const [provider, setProvider] = useState(rule?.provider ?? "");
  const [code, setCode] = useState(rule?.code ?? "service_charge");
  const [label, setLabel] = useState(rule?.label ?? "Service charge");
  const [rate, setRate] = useState(rule ? String(rule.rateBps / 100) : "");
  const [fixed, setFixed] = useState(rule ? inputFromKobo(rule.fixed) : "");
  const [min, setMin] = useState(rule ? inputFromKobo(rule.min) : "");
  const [max, setMax] = useState(inputFromKobo(rule?.max));
  const [active, setActive] = useState(rule?.active ?? true);
  const [local, setLocal] = useState<Record<string, string>>({});

  const errors = { ...fieldErrors(mutation.error), ...local };
  const rateBps = percentToBps(rate);
  const draft = { rateBps: rateBps ?? 0, fixed: koboFromInput(fixed) ?? 0, min: koboFromInput(min) ?? 0, max: koboFromInput(max) };

  const submit = () => {
    const problems: Record<string, string> = {};
    if (rateBps === null) problems.rateBps = "A percentage from 0 to 100";
    if (provider.trim() && serviceId === ANY) problems.provider = "A provider rule needs a service";
    if (draft.max !== null && draft.max < draft.min) problems.max = "The most can't be less than the least";
    setLocal(problems);
    if (Object.keys(problems).length > 0 || rateBps === null) return;

    const money = { label: label.trim(), rateBps, fixed: draft.fixed, min: draft.min, max: draft.max, active };
    const onSuccess = () => {
      toast.success(rule ? "Charge rule saved. Quotes pick it up within 30 seconds." : "Charge rule added. Quotes pick it up within 30 seconds.");
      onDone();
    };
    if (rule) update.mutate({ id: rule.id, ...money }, { onSuccess });
    else
      create.mutate(
        {
          ...money,
          scope,
          serviceId: serviceId === ANY ? null : (serviceId as ChargeRule["serviceId"]),
          provider: provider.trim() ? provider.trim().toUpperCase() : null,
          code: code.trim().toLowerCase(),
        },
        { onSuccess },
      );
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <DialogHeader>
        <DialogTitle className="text-base">{rule ? "Edit charge rule" : "New charge rule"}</DialogTitle>
        <DialogDescription>
          Charge = amount × rate + fixed, then kept between the least and the most. Quotes already given keep their old price.
        </DialogDescription>
      </DialogHeader>

      {rule ? (
        <div className="rounded-lg bg-grey-25 p-3 text-sm text-grey-500">
          Applies to <span className="font-medium text-grey-800">{SCOPE_LABELS[rule.scope]}</span>
          {rule.serviceId && <> · {serviceLabel(rule.serviceId)}</>}
          {rule.provider && <> · {rule.provider}</>} · code <span className="font-mono">{rule.code}</span>. To change where it applies, add a new rule
          and delete this one.
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Scope" error={errors.scope}>
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
            <FormField label="Service" error={errors.serviceId} hint="Leave on any to cover the whole scope.">
              <Select value={serviceId} onValueChange={setServiceId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any service</SelectItem>
                  {SERVICE_IDS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {SERVICE_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="cr-provider" label="Provider (optional)" error={errors.provider} hint="A provider code such as MTN or IKEDC. Needs a service.">
              <Input id="cr-provider" value={provider} error={!!errors.provider} onChange={(e) => setProvider(e.target.value.toUpperCase())} placeholder="MTN" />
            </FormField>
            <FormField id="cr-code" label="Code" error={errors.code} hint="Rules with the same code compete; different codes add up.">
              <Input id="cr-code" value={code} error={!!errors.code} className="font-mono" onChange={(e) => setCode(e.target.value.toLowerCase())} />
            </FormField>
          </div>
        </>
      )}

      <FormField id="cr-label" label="Label" error={errors.label} hint="What the user sees on their receipt.">
        <Input id="cr-label" maxLength={60} value={label} error={!!errors.label} onChange={(e) => setLabel(e.target.value)} />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="cr-rate" label="Rate" error={errors.rateBps}>
          <Input id="cr-rate" type="number" step="0.01" min={0} max={100} value={rate} error={!!errors.rateBps} rightSlot={<span className="text-sm">%</span>} onChange={(e) => setRate(e.target.value)} placeholder="0" />
        </FormField>
        <FormField id="cr-fixed" label="Fixed" error={errors.fixed}>
          <NairaInput id="cr-fixed" value={fixed} error={!!errors.fixed} onChange={setFixed} placeholder="0" />
        </FormField>
        <FormField id="cr-min" label="At least" error={errors.min}>
          <NairaInput id="cr-min" value={min} error={!!errors.min} onChange={setMin} placeholder="0" />
        </FormField>
        <FormField id="cr-max" label="At most" error={errors.max} hint="Blank = no cap.">
          <NairaInput id="cr-max" value={max} error={!!errors.max} onChange={setMax} />
        </FormField>
      </div>

      <label className="flex items-center justify-between gap-4 rounded-lg border border-grey-50 px-3 py-2.5">
        <span>
          <span className="block text-sm text-grey-800">Active</span>
          <span className="block text-xs text-grey-400">
            An inactive rule still wins over broader ones, so it switches this charge off where it applies (e.g. free airtime).
          </span>
        </span>
        <Switch checked={active} onCheckedChange={setActive} />
      </label>

      <p className="text-sm text-grey-500">
        Reads as: <span className="font-medium text-grey-800">{active ? describeRule(draft) : "No charge (switched off)"}</span>
      </p>

      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Saving…" : rule ? "Save rule" : "Add rule"}
        </Button>
      </DialogFooter>
    </form>
  );
}
