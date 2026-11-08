import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/shared/ui/checkbox";
import { Input, type InputProps } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { SERVICE_IDS, SERVICE_LABELS, type ServiceId } from "@/features/coupons/money";

/** A labelled form field with the API's message for it underneath. */
export function FormField({
  id,
  label,
  error,
  hint,
  children,
  className,
}: {
  id?: string;
  label: ReactNode;
  error?: string | undefined;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : hint ? <p className="text-xs text-grey-400">{hint}</p> : null}
    </div>
  );
}

/** Naira typed as a plain number; the caller converts to kobo on submit. */
export function NairaInput({ value, onChange, ...props }: Omit<InputProps, "value" | "onChange" | "type"> & { value: string; onChange: (value: string) => void }) {
  return (
    <Input
      {...props}
      type="text"
      inputMode="decimal"
      leftSlot={<span className="text-sm">₦</span>}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ""))}
    />
  );
}

/** "Every bill" or a chosen set of services. */
export function ServicesPicker({
  value,
  onChange,
  disabled,
}: {
  value: "all" | ServiceId[];
  onChange: (value: "all" | ServiceId[]) => void;
  disabled?: boolean;
}) {
  const all = value === "all";
  const chosen = all ? [] : value;
  const toggle = (id: ServiceId, on: boolean) => {
    const next = on ? [...chosen, id] : chosen.filter((s) => s !== id);
    onChange(next);
  };
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm text-grey-800">
        <Checkbox checked={all} disabled={disabled} onCheckedChange={(on) => onChange(on === true ? "all" : [])} />
        Every bill
      </label>
      {!all && (
        <div className="grid grid-cols-2 gap-2 rounded-lg border border-grey-50 p-3">
          {SERVICE_IDS.map((id) => (
            <label key={id} className="flex items-center gap-2 text-sm text-grey-500">
              <Checkbox checked={chosen.includes(id)} disabled={disabled} onCheckedChange={(on) => toggle(id, on === true)} />
              {SERVICE_LABELS[id]}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
