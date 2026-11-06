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
import { Textarea } from "@/shared/ui/textarea";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FormTextareaProps<T extends FieldValues = FieldValues> extends Omit<
  React.ComponentProps<"textarea">,
  "name" | "id"
> {
  name: Path<T>;
  control?: Control<T>;
  label?: React.ReactNode;
  description?: React.ReactNode;
  topRightElement?: React.ReactNode;
  errorMessage?: string | undefined;
  errors?: FieldErrors<T>;
  id?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Component ────────────────────────────────────────────────────────────────

function FormTextarea<T extends FieldValues>({
  name,
  control,
  label,
  description,
  topRightElement,
  errorMessage,
  errors,
  id: idProp,
  ...textareaProps
}: FormTextareaProps<T>) {
  const id = idProp ?? name;
  const descriptionId = description ? `${id}-description` : undefined;

  // ── Standalone mode (no RHF control) ──────────────────────────────────────
  if (!control) {
    const error = errorMessage ?? getErrorMessage(errors, name);

    return (
      <Field className="gap-1.5" data-invalid={error ? true : undefined}>
        <FieldHeader label={label} topRightElement={topRightElement} htmlFor={id} />
        <Textarea
          {...textareaProps}
          id={id}
          name={name}
          aria-invalid={!!error}
          aria-describedby={descriptionId}
        />
        {error && <FieldError>{error}</FieldError>}
        {description && !error && (
          <FieldDescription id={descriptionId}>{description}</FieldDescription>
        )}
      </Field>
    );
  }

  // ── Controlled mode (RHF Controller) ──────────────────────────────────────
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => {
        const error = fieldState.error?.message ?? errorMessage;

        return (
          <Field className="gap-1.5" data-invalid={error ? true : undefined}>
            <FieldHeader label={label} topRightElement={topRightElement} htmlFor={id} />
            <Textarea
              {...textareaProps}
              {...field}
              id={id}
              value={(field.value as string | undefined) ?? ""}
              aria-invalid={!!error}
              aria-describedby={descriptionId}
            />
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

FormTextarea.displayName = "FormTextarea";

export default FormTextarea;
