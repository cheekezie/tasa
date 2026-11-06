import { useState } from "react";
import { toast } from "sonner";
import { AUDIENCE_LABELS, useCreatePromotion, useUpdatePromotion, type PromoAudience, type PromoInput, type Promotion } from "@/features/promotions/api";
import { FormField, NairaInput, ServicesPicker } from "@/features/coupons/components/FormBits";
import { fieldErrors, inputFromKobo, koboFromInput, localInput, type ServiceId } from "@/features/coupons/money";
import { naira } from "@/lib/format";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Switch } from "@/shared/ui/switch";
import { Textarea } from "@/shared/ui/textarea";

/** Create (no `promo`) or edit a promotion. Calls `onSaved` with the API's warnings. */
export function PromotionDialog({
  open,
  promo,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  promo: Promotion | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (warnings: string[], code: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {open && (
          <PromoForm
            key={promo?.id ?? "new"}
            promo={promo}
            onCancel={() => onOpenChange(false)}
            onSaved={(w, code) => {
              onOpenChange(false);
              onSaved(w, code);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PromoForm({ promo, onCancel, onSaved }: { promo: Promotion | null; onCancel: () => void; onSaved: (warnings: string[], code: string) => void }) {
  const create = useCreatePromotion();
  const update = useUpdatePromotion();
  const mutation = promo ? update : create;
  const r = promo?.rules;

  const [code, setCode] = useState("");
  const [title, setTitle] = useState(promo?.title ?? "");
  const [description, setDescription] = useState(promo?.description ?? "");
  const [valueType, setValueType] = useState<"percent" | "fixed">(r?.valueType ?? "percent");
  const [value, setValue] = useState(r ? (r.valueType === "percent" ? String(r.value) : inputFromKobo(r.value)) : "");
  const [maxDiscount, setMaxDiscount] = useState(inputFromKobo(r?.maxDiscount));
  const [minSpend, setMinSpend] = useState(r ? inputFromKobo(r.minSpend) : "");
  const [appliesTo, setAppliesTo] = useState<"amount" | "fee">(r?.appliesTo ?? "amount");
  const [budget, setBudget] = useState(inputFromKobo(r?.budget));
  const [usesPerUser, setUsesPerUser] = useState(String(r?.usesPerUser ?? 1));
  const [audience, setAudience] = useState<PromoAudience>(r?.audience ?? "all");
  const [autoApply, setAutoApply] = useState(r?.autoApply ?? false);
  const [listed, setListed] = useState(r?.listed ?? true);
  const [services, setServices] = useState<"all" | ServiceId[]>(promo?.services ?? "all");
  const [providers, setProviders] = useState(promo?.providers.join(", ") ?? "");
  const [startsAt, setStartsAt] = useState(localInput(promo?.startsAt));
  const [expiresAt, setExpiresAt] = useState(localInput(promo?.expiresAt));
  const [status, setStatus] = useState<"active" | "paused">(promo?.status === "paused" ? "paused" : "active");
  const [local, setLocal] = useState<Record<string, string>>({});

  const errors = { ...fieldErrors(mutation.error), ...local };

  const submit = () => {
    const problems: Record<string, string> = {};
    const numericValue = valueType === "percent" ? Number(value) : koboFromInput(value);
    const cap = koboFromInput(maxDiscount);
    const min = koboFromInput(minSpend) ?? 0;
    const budgetKobo = koboFromInput(budget);
    if (!numericValue || numericValue <= 0) problems.value = valueType === "percent" ? "Enter a percentage" : "Enter an amount in naira";
    else if (valueType === "percent" && (!Number.isInteger(numericValue) || numericValue > 100)) problems.value = "A whole percentage from 1 to 100";
    if (valueType === "percent" && !cap) problems.maxDiscount = "Percentage promos need a cap per use";
    if (!budgetKobo) problems.budget = "Enter the total Tela will spend";
    if (!expiresAt) problems.expiresAt = "Choose when it ends";
    if (services !== "all" && services.length === 0) problems.services = "Pick at least one service, or every bill";
    setLocal(problems);
    if (Object.keys(problems).length > 0 || !numericValue || !budgetKobo) return;

    const body: PromoInput = {
      title: title.trim(),
      ...(description.trim() || promo ? { description: description.trim() } : {}),
      valueType,
      value: numericValue,
      maxDiscount: cap || null,
      minSpend: min,
      appliesTo,
      budget: budgetKobo,
      usesPerUser: Number(usesPerUser),
      audience,
      autoApply,
      listed,
      services,
      providers: providers
        .split(/[,\s]+/)
        .map((p) => p.trim().toUpperCase())
        .filter(Boolean),
      ...(startsAt ? { startsAt: new Date(startsAt).toISOString() } : {}),
      expiresAt: new Date(expiresAt).toISOString(),
    };
    const done = ({ promo: saved, warnings }: { promo: Promotion; warnings: string[] }) => {
      toast.success(promo ? `${saved.code} saved` : `${saved.code} created`);
      onSaved(warnings, saved.code);
    };
    if (promo) update.mutate({ id: promo.id, ...body, status }, { onSuccess: done });
    else create.mutate({ ...body, code: code.trim().toUpperCase() }, { onSuccess: done });
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
        <DialogTitle className="text-base">{promo ? `Edit ${promo.code}` : "New promotion"}</DialogTitle>
        <DialogDescription>
          A code Tela pays for. Every discount is booked as a cost{promo ? `; ${naira(promo.stats.spent)} spent so far, so the budget can't go lower` : ""}.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 sm:grid-cols-2">
        {promo ? (
          <FormField label="Code">
            <p className="font-mono text-sm text-grey-800">{promo.code}</p>
          </FormField>
        ) : (
          <FormField id="pr-code" label="Code" error={errors.code} hint="4–24 letters, numbers or dashes. Can't be changed later.">
            <Input id="pr-code" maxLength={24} value={code} error={!!errors.code} className="font-mono" placeholder="DECEMBER50" onChange={(e) => setCode(e.target.value.toUpperCase())} />
          </FormField>
        )}
        <FormField id="pr-title" label="Title" error={errors.title}>
          <Input id="pr-title" maxLength={60} value={title} error={!!errors.title} placeholder="December 50% off" onChange={(e) => setTitle(e.target.value)} />
        </FormField>
      </div>

      <FormField id="pr-desc" label="Description (optional)" error={errors.description}>
        <Textarea id="pr-desc" maxLength={280} value={description} onChange={(e) => setDescription(e.target.value)} />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label="Discount type" error={errors.valueType}>
          <Select
            value={valueType}
            onValueChange={(v) => {
              setValueType(v as "percent" | "fixed");
              setValue("");
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="percent">Percentage off</SelectItem>
              <SelectItem value="fixed">Fixed amount off</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        <FormField id="pr-value" label={valueType === "percent" ? "Percentage" : "Amount off"} error={errors.value}>
          {valueType === "percent" ? (
            <Input id="pr-value" type="number" min={1} max={100} value={value} error={!!errors.value} rightSlot={<span className="text-sm">%</span>} onChange={(e) => setValue(e.target.value)} />
          ) : (
            <NairaInput id="pr-value" value={value} error={!!errors.value} onChange={setValue} />
          )}
        </FormField>
        <FormField
          id="pr-cap"
          label={valueType === "percent" ? "Cap per use" : "Cap per use (optional)"}
          error={errors.maxDiscount}
          hint={valueType === "percent" ? "Required: stops one big electricity bill eating the budget." : undefined}
        >
          <NairaInput id="pr-cap" value={maxDiscount} error={!!errors.maxDiscount} onChange={setMaxDiscount} />
        </FormField>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label="Takes off" error={errors.appliesTo}>
          <Select value={appliesTo} onValueChange={(v) => setAppliesTo(v as "amount" | "fee")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="amount">The bill amount</SelectItem>
              <SelectItem value="fee">Only Tela's charges</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        <FormField id="pr-min" label="Smallest bill" error={errors.minSpend} hint="Blank = any bill.">
          <NairaInput id="pr-min" value={minSpend} error={!!errors.minSpend} onChange={setMinSpend} placeholder="0" />
        </FormField>
        <FormField id="pr-budget" label="Total budget" error={errors.budget} hint="The promo stops when this is spent.">
          <NairaInput id="pr-budget" value={budget} error={!!errors.budget} onChange={setBudget} />
        </FormField>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="pr-uses" label="Uses per person" error={errors.usesPerUser}>
          <Input id="pr-uses" type="number" min={1} max={100} value={usesPerUser} error={!!errors.usesPerUser} onChange={(e) => setUsesPerUser(e.target.value)} />
        </FormField>
        <FormField label="Who can use it" error={errors.audience}>
          <Select value={audience} onValueChange={(v) => setAudience(v as PromoAudience)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(AUDIENCE_LABELS) as PromoAudience[]).map((a) => (
                <SelectItem key={a} value={a}>
                  {AUDIENCE_LABELS[a]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      </div>

      <FormField label="Works on" error={errors.services}>
        <ServicesPicker value={services} onChange={setServices} />
      </FormField>
      <FormField id="pr-prov" label="Only these providers (optional)" error={errors.providers} hint="Provider codes, comma-separated (MTN, IKEDC, DSTV). Blank = any provider.">
        <Input id="pr-prov" value={providers} error={!!errors.providers} onChange={(e) => setProviders(e.target.value)} placeholder="MTN, AIRTEL" />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="pr-start" label="Starts" error={errors.startsAt} hint={promo ? undefined : "Blank = now."}>
          <Input id="pr-start" type="datetime-local" value={startsAt} error={!!errors.startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </FormField>
        <FormField id="pr-exp" label="Ends" error={errors.expiresAt}>
          <Input id="pr-exp" type="datetime-local" value={expiresAt} error={!!errors.expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
        </FormField>
      </div>

      <div className="divide-y divide-grey-50 rounded-lg border border-grey-50">
        <ToggleRow label="Apply automatically" hint="Every eligible bill gets it without typing a code." checked={autoApply} onChange={setAutoApply} />
        <ToggleRow label="Show in the app" hint="Off for partner or influencer codes people must be given." checked={listed} onChange={setListed} />
        {promo && <ToggleRow label="Paused" hint="Nobody can use it while paused." checked={status === "paused"} onChange={(on) => setStatus(on ? "paused" : "active")} />}
      </div>

      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Saving…" : promo ? "Save changes" : "Create promotion"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ToggleRow({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-4 px-3 py-2.5">
      <span>
        <span className="block text-sm text-grey-800">{label}</span>
        <span className="block text-xs text-grey-400">{hint}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}
