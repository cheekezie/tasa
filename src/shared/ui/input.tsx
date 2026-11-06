import * as React from "react";
import { Eye, EyeOff, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Date helpers ─────────────────────────────────────────────────────────────

function isoToDisplay(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function displayToIso(display: string): string {
  if (!display) return "";
  const [d, m, y] = display.split("/");
  if (!d || !m || !y || y.length < 4) return display;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

const DATE_RIGHT_SLOT = <Calendar size={16} className="text-muted-foreground" />;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InputProps extends React.ComponentProps<"input"> {
  leftSlot?: React.ReactNode;
  rightSlot?: React.ReactNode;
  isPassword?: boolean;
  error?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      type,
      leftSlot,
      rightSlot,
      isPassword,
      error,
      value,
      onChange,
      placeholder,
      maxLength,
      inputMode,
      ...props
    },
    ref,
  ) => {
    const [showPassword, setShowPassword] = React.useState(false);
    const isDate = type === "date";

    const resolvedType = isPassword ? (showPassword ? "text" : "password") : type;
    const resolvedPlaceholder = isPassword
      ? (placeholder ?? "••••••••")
      : isDate
        ? (placeholder ?? "dd/mm/yyyy")
        : placeholder;
    const resolvedMaxLength = isDate ? (maxLength ?? 10) : maxLength;
    const resolvedInputMode = isDate ? ("numeric" as const) : inputMode;
    const resolvedValue = isDate && typeof value === "string" ? isoToDisplay(value) : value;
    const resolvedOnChange = isDate
      ? (e: React.ChangeEvent<HTMLInputElement>) => {
          const patched = {
            ...e,
            target: { ...e.target, value: displayToIso(e.target.value) },
          };
          onChange?.(patched as React.ChangeEvent<HTMLInputElement>);
        }
      : onChange;
    const resolvedRightSlot = isDate && !rightSlot ? DATE_RIGHT_SLOT : rightSlot;
    const hasSlots = !!(leftSlot || resolvedRightSlot || isPassword);

    const wrapperClass = cn(
      "flex h-10 w-full items-center gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs",
      "transition-[color,box-shadow]",
      "has-[input:focus-visible]:border-primary/50 has-[input:focus-visible]:ring-[3px] has-[input:focus-visible]:ring-primary/10",
      "has-[input:disabled]:pointer-events-none has-[input:disabled]:opacity-50",
      "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
      "aria-invalid:has-[input:focus-visible]:border-destructive aria-invalid:has-[input:focus-visible]:ring-destructive/20",
      "dark:bg-input/30",
    );

    const innerInputClass = cn(
      "min-w-0 flex-1 bg-transparent outline-none",
      "placeholder:text-muted-foreground",
      "selection:bg-primary selection:text-primary-foreground",
      "file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
      "disabled:pointer-events-none",
    );

    if (!hasSlots) {
      return (
        <input
          ref={ref}
          type={resolvedType}
          data-slot="input"
          aria-invalid={error || undefined}
          placeholder={resolvedPlaceholder}
          maxLength={resolvedMaxLength}
          inputMode={resolvedInputMode}
          value={resolvedValue}
          onChange={resolvedOnChange}
          className={cn(
            "h-10 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs",
            "transition-[color,box-shadow] outline-none",
            "placeholder:text-muted-foreground",
            "selection:bg-primary selection:text-primary-foreground",
            "file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
            "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
            "focus-visible:border-primary/50 focus-visible:ring-[3px] focus-visible:ring-primary/10",
            "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
            "aria-invalid:focus-visible:border-destructive aria-invalid:focus-visible:ring-destructive/20",
            "dark:bg-input/30",
            className,
          )}
          {...props}
        />
      );
    }

    return (
      <div
        data-slot="input"
        aria-invalid={error || undefined}
        className={cn(wrapperClass, className)}
      >
        {leftSlot && <span className="shrink-0 text-muted-foreground">{leftSlot}</span>}

        <input
          ref={ref}
          type={resolvedType}
          placeholder={resolvedPlaceholder}
          maxLength={resolvedMaxLength}
          inputMode={resolvedInputMode}
          value={resolvedValue}
          onChange={resolvedOnChange}
          className={innerInputClass}
          {...props}
        />

        {isPassword ? (
          <button
            type="button"
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            onClick={() => setShowPassword((v) => !v)}
            className="shrink-0 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none"
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        ) : (
          resolvedRightSlot && (
            <span className="shrink-0 text-muted-foreground">{resolvedRightSlot}</span>
          )
        )}
      </div>
    );
  },
);

Input.displayName = "Input";

export { Input };
