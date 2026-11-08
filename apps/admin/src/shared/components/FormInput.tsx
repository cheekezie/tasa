import * as React from "react";
import {
  Controller,
  type Control,
  type FieldErrors,
  type FieldValues,
  type Path,
} from "react-hook-form";

import { Field, FieldDescription, FieldError } from "@/shared/ui/field";
import { FieldHeader } from "@/shared/ui/field-header";
import { Input, type InputProps } from "@/shared/ui/input";
import { ChevronDown } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FormInputProps<T extends FieldValues = FieldValues> extends Omit<
  InputProps,
  "name" | "id" | "prefix"
> {
  /**
   * Field name. Must match a key (or dot-path) in your form schema.
   * Also used as the `id` for the `<label>` association unless `id` is given.
   */
  name: Path<T>;

  /**
   * `control` object returned by `useForm()`.
   * When omitted the component renders in standalone (uncontrolled) mode —
   * it still renders the full label / error / description layout but does
   * not register with react-hook-form.
   */
  control?: Control<T>;

  /** Label text or element rendered above the input. */
  label?: React.ReactNode;

  /**
   * Helper text shown below the input when there is no active error.
   * Useful for hints like "Must be at least 8 characters".
   */
  description?: React.ReactNode;

  /**
   * An element rendered to the right of the label (e.g. a "Forgot password?" link).
   * Only visible when `label` is also provided.
   */
  topRightElement?: React.ReactNode;

  /**
   * Explicit error message for standalone mode.
   * In controlled mode the error from `fieldState.error.message` takes precedence;
   * this value acts as a fallback (e.g. a server-side error you want to surface).
   */
  errorMessage?: string | undefined;

  /**
   * Full `errors` object from `useForm()` — convenient in standalone mode when
   * you want to pass the whole errors map rather than resolving the message yourself.
   * Ignored when `control` is provided (use `fieldState.error` instead).
   */
  errors?: FieldErrors<T>;

  /** Explicit id for the `<input>`. Defaults to `name`. */
  id?: string;

  /**
   * Content rendered to the left of the input field with an automatic
   * `border-right` separator — useful for country-code diallers, currency
   * symbols, or any fixed inline prefix.
   * Takes precedence over `leftSlot` when both are provided.
   */
  prefix?: React.ReactNode;

  showPrefix?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Safely reads a potentially-nested error message from a `FieldErrors` map
 * using a dot-separated `Path` string (e.g. `"address.street"`).
 */
function getErrorMessage<T extends FieldValues>(
  errors: FieldErrors<T> | undefined,
  name: Path<T>,
): string | undefined {
  if (!errors) return undefined;

  const parts = (name as string).split(".");
  let node: unknown = errors;

  for (const part of parts) {
    if (node == null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }

  if (node != null && typeof node === "object" && "message" in node) {
    const msg = (node as { message?: unknown }).message;
    return typeof msg === "string" ? msg : undefined;
  }

  return undefined;
}

// ─── Phone prefix selector ────────────────────────────────────────────────────

function CountryCodeButton({ prefix }: { prefix: React.ReactNode }) {
  return (
    <button
      type="button"
      className="flex h-10 shrink-0 items-center gap-1.5 rounded-md border border-input bg-transparent px-3 text-sm text-foreground transition-[color,box-shadow] hover:bg-accent focus-visible:border-primary/50 focus-visible:ring-[3px] focus-visible:ring-primary/10 focus-visible:outline-none"
    >
      {prefix}
      <ChevronDown className="size-3 text-muted-foreground" />
    </button>
  );
}

const DEFAULT_PREFIX = <>🇳🇬 +234</>;

// ─── Component ────────────────────────────────────────────────────────────────

function FormInput<T extends FieldValues>({
  name,
  control,
  label,
  description,
  topRightElement,
  errorMessage,
  errors,
  id: idProp,
  prefix = DEFAULT_PREFIX,
  showPrefix = false,
  leftSlot: leftSlotProp,
  ...inputProps
}: FormInputProps<T>) {
  const id = idProp ?? name;
  const descriptionId = description ? `${id}-description` : undefined;

  const isPhone = inputProps.type === "tel" && showPrefix;

  // ── Standalone mode (no RHF control) ────────────────────────────────────
  if (!control) {
    const error = errorMessage ?? getErrorMessage(errors, name);

    return (
      <Field className="gap-1.5" data-invalid={error ? true : undefined}>
        <FieldHeader label={label} topRightElement={topRightElement} htmlFor={id} />
        {isPhone ? (
          <div className="flex gap-2">
            <CountryCodeButton prefix={prefix} />
            <Input
              {...inputProps}
              id={id}
              name={name}
              error={!!error}
              aria-describedby={descriptionId}
              className="flex-1"
            />
          </div>
        ) : (
          <Input
            {...inputProps}
            leftSlot={leftSlotProp}
            id={id}
            name={name}
            error={!!error}
            aria-describedby={descriptionId}
          />
        )}
        {error && <FieldError>{error}</FieldError>}
        {description && !error && (
          <FieldDescription id={descriptionId}>{description}</FieldDescription>
        )}
      </Field>
    );
  }

  // ── Controlled mode (RHF Controller) ────────────────────────────────────
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => {
        const error = fieldState.error?.message ?? errorMessage;

        return (
          <Field className="gap-1.5" data-invalid={error ? true : undefined}>
            <FieldHeader label={label} topRightElement={topRightElement} htmlFor={id} />
            {isPhone ? (
              <div className="flex gap-2">
                <CountryCodeButton prefix={prefix} />
                <Input
                  {...inputProps}
                  {...field}
                  id={id}
                  value={(field.value as string | undefined) ?? ""}
                  error={!!error}
                  aria-describedby={descriptionId}
                  className="flex-1"
                />
              </div>
            ) : (
              <Input
                {...inputProps}
                {...field}
                leftSlot={leftSlotProp}
                id={id}
                value={(field.value as string | undefined) ?? ""}
                error={!!error}
                aria-describedby={descriptionId}
              />
            )}
            {error && <FieldError>{error}</FieldError>}
            {description && !error && (
              <FieldDescription id={descriptionId}>{description}</FieldDescription>
            )}
          </Field>
        );
      }}
    />
  );
}

FormInput.displayName = "FormInput";

export default FormInput;
