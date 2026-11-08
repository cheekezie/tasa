import * as React from "react";
import { ChevronDown } from "lucide-react";
import {
  Controller,
  type Control,
  type FieldErrors,
  type FieldValues,
  type Path,
} from "react-hook-form";
import { cn } from "@/lib/utils";
import { Field, FieldDescription, FieldError } from "@/shared/ui/field";
import { FieldHeader } from "@/shared/ui/field-header";
import { Button } from "@/shared/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { SearchPopoverSelect } from "@/shared/ui/search-popover-select";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SelectOption {
  label: string;
  value: string;
  disabled?: boolean;
}

export interface FormSelectProps<T extends FieldValues = FieldValues> {
  name: Path<T>;
  control?: Control<T>;
  label?: React.ReactNode;
  description?: React.ReactNode;
  topRightElement?: React.ReactNode;
  errorMessage?: string | undefined;
  errors?: FieldErrors<T>;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  options?: SelectOption[];
  children?: React.ReactNode;
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  searchable?: boolean;
  searchPlaceholder?: string;
  contentAlign?: "start" | "center" | "end";
}

type SearchSelectControlProps = {
  id: string;
  value: string;
  options: SelectOption[];
  placeholder?: string | undefined;
  searchPlaceholder?: string | undefined;
  disabled?: boolean | undefined;
  error?: boolean | undefined;
  className?: string | undefined;
  contentAlign?: "start" | "center" | "end" | undefined;
  describedBy?: string | undefined;
  onValueChange: (value: string) => void;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getErrorMessage<T extends FieldValues>(
  errors: FieldErrors<T> | undefined,
  name: Path<T>
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

function SearchSelectControl({
  id,
  value,
  options,
  placeholder,
  searchPlaceholder,
  disabled,
  error,
  className,
  contentAlign,
  describedBy,
  onValueChange,
}: SearchSelectControlProps) {
  return (
    <SearchPopoverSelect
      value={value}
      options={options}
      placeholder={placeholder}
      searchPlaceholder={searchPlaceholder}
      disabled={disabled}
      align={contentAlign}
      onValueChange={onValueChange}
      renderTrigger={({ labelRef, triggerText, onPointerEnter }) => (
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-invalid={error || undefined}
          aria-describedby={describedBy}
          className={cn(
            "h-10 w-full justify-between gap-2 border-input bg-transparent px-3 py-2 text-sm font-normal shadow-xs",
            "hover:bg-transparent",
            !value && "text-muted-foreground",
            value && "text-grey-800",
            error &&
              "border-destructive ring-destructive/20 aria-invalid:ring-destructive/20",
            className
          )}
          onPointerEnter={onPointerEnter}
        >
          <span ref={labelRef} className="min-w-0 truncate text-left text-sm">
            {triggerText}
          </span>
          <ChevronDown className="size-4 shrink-0 opacity-50" />
        </Button>
      )}
    />
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

function FormSelect<T extends FieldValues>({
  name,
  control,
  label,
  description,
  topRightElement,
  errorMessage,
  errors,
  id: idProp,
  placeholder,
  disabled,
  className,
  options = [],
  children,
  defaultValue,
  value,
  onValueChange,
  searchable = false,
  searchPlaceholder = "Search…",
  contentAlign = "start",
}: FormSelectProps<T>) {
  const id = idProp ?? name;
  const descriptionId = description ? `${id}-description` : undefined;

  if (!control) {
    const error = errorMessage ?? getErrorMessage(errors, name);
    const currentValue = value ?? defaultValue ?? "";

    return (
      <Field className="gap-1.5" data-invalid={error ? true : undefined}>
        <FieldHeader label={label} topRightElement={topRightElement} htmlFor={id} />
        {searchable ? (
          <SearchSelectControl
            id={id}
            value={currentValue}
            options={options}
            placeholder={placeholder}
            searchPlaceholder={searchPlaceholder}
            disabled={disabled}
            error={!!error}
            className={className}
            contentAlign={contentAlign}
            describedBy={descriptionId}
            onValueChange={(nextValue) => onValueChange?.(nextValue)}
          />
        ) : (
          <Select
            name={name}
            {...(disabled != null && { disabled })}
            {...(defaultValue != null && { defaultValue })}
            {...(value != null && { value })}
            {...(onValueChange != null && { onValueChange })}
          >
            <SelectTrigger
              id={id}
              error={!!error}
              className={className}
              aria-describedby={descriptionId}
            >
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
              {options.map((opt) => (
                <SelectItem
                  key={opt.value}
                  value={opt.value}
                  disabled={opt.disabled ?? false}
                >
                  {opt.label}
                </SelectItem>
              ))}
              {children}
            </SelectContent>
          </Select>
        )}
        {error && <FieldError>{error}</FieldError>}
        {description && !error && (
          <FieldDescription id={descriptionId}>{description}</FieldDescription>
        )}
      </Field>
    );
  }

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => {
        const error = fieldState.error?.message ?? errorMessage;

        return (
          <Field className="gap-1.5" data-invalid={error ? true : undefined}>
            <FieldHeader label={label} topRightElement={topRightElement} htmlFor={id} />
            {searchable ? (
              <SearchSelectControl
                id={id}
                value={(field.value as string | undefined) ?? ""}
                options={options}
                placeholder={placeholder}
                searchPlaceholder={searchPlaceholder}
                disabled={disabled ?? field.disabled}
                error={!!error}
                className={className}
                contentAlign={contentAlign}
                describedBy={descriptionId}
                onValueChange={(nextValue) => {
                  field.onChange(nextValue);
                  onValueChange?.(nextValue);
                }}
              />
            ) : (
              <Select
                name={field.name}
                {...((disabled ?? field.disabled) != null && {
                  disabled: disabled ?? field.disabled,
                })}
                value={(field.value as string | undefined) ?? ""}
                onValueChange={(val) => {
                  field.onChange(val);
                  onValueChange?.(val);
                }}
              >
                <SelectTrigger
                  id={id}
                  error={!!error}
                  className={className}
                  aria-describedby={descriptionId}
                  ref={field.ref}
                >
                  <SelectValue placeholder={placeholder} />
                </SelectTrigger>
                <SelectContent>
                  {options.map((opt) => (
                    <SelectItem
                      key={opt.value}
                      value={opt.value}
                      disabled={opt.disabled ?? false}
                    >
                      {opt.label}
                    </SelectItem>
                  ))}
                  {children}
                </SelectContent>
              </Select>
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

FormSelect.displayName = "FormSelect";

export default FormSelect;
