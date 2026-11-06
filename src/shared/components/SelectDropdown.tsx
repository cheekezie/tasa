import { ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/shared/ui/button";
import { SearchPopoverSelect } from "@/shared/ui/search-popover-select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

export type SelectDropdownOption<T extends string = string> = {
  label: string;
  value: T;
  disabled?: boolean;
};

type SelectDropdownProps<T extends string = string> = {
  options: SelectDropdownOption<T>[];
  value?: T;
  defaultValue?: T;
  placeholder?: string;
  ariaLabel?: string;
  onValueChange?: (value: T) => void;
  className?: string;
  contentClassName?: string;
  align?: "start" | "center" | "end";
  triggerVariant?: React.ComponentProps<typeof Button>["variant"];
  triggerSize?: React.ComponentProps<typeof Button>["size"];
  searchable?: boolean;
  searchPlaceholder?: string;
};

export function SelectDropdown<T extends string = string>({
  options,
  value,
  defaultValue,
  placeholder = "Select",
  ariaLabel,
  onValueChange,
  className,
  contentClassName,
  align = "end",
  triggerVariant = "outline",
  triggerSize = "sm",
  searchable = false,
  searchPlaceholder = "Search…",
}: SelectDropdownProps<T>) {
  const isControlled = value !== undefined;
  const [internalValue, setInternalValue] = useState<T | undefined>(defaultValue);
  const selectedValue = isControlled ? value : internalValue;

  const selectedLabel = useMemo(
    () => options.find((option) => option.value === selectedValue)?.label,
    [options, selectedValue]
  );

  const handleValueChange = (nextValue: T) => {
    if (!isControlled) {
      setInternalValue(nextValue);
    }
    onValueChange?.(nextValue);
  };

  if (searchable) {
    return (
      <SearchableSelectDropdown
        options={options}
        selectedValue={selectedValue}
        placeholder={placeholder}
        ariaLabel={ariaLabel}
        onValueChange={handleValueChange}
        className={className}
        contentClassName={contentClassName}
        align={align}
        triggerVariant={triggerVariant}
        triggerSize={triggerSize}
        searchPlaceholder={searchPlaceholder}
      />
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={triggerVariant}
          size={triggerSize}
          className={cn("justify-between text-sm text-grey-300", className)}
          aria-label={ariaLabel}
        >
          {selectedLabel ?? placeholder}
          <ChevronDown className="size-4" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align={align} className={contentClassName}>
        <DropdownMenuRadioGroup
          value={selectedValue ?? ""}
          onValueChange={(nextValue) => handleValueChange(nextValue as T)}
        >
          {options.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              disabled={option.disabled ?? false}
            >
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type SearchableSelectDropdownProps<T extends string = string> = {
  options: SelectDropdownOption<T>[];
  selectedValue: T | undefined;
  placeholder: string;
  ariaLabel?: string | undefined;
  onValueChange: (value: T) => void;
  className?: string | undefined;
  contentClassName?: string | undefined;
  align: "start" | "center" | "end";
  triggerVariant: React.ComponentProps<typeof Button>["variant"];
  triggerSize: React.ComponentProps<typeof Button>["size"];
  searchPlaceholder: string;
};

function SearchableSelectDropdown<T extends string = string>({
  options,
  selectedValue,
  placeholder,
  ariaLabel,
  onValueChange,
  className,
  contentClassName,
  align,
  triggerVariant,
  triggerSize,
  searchPlaceholder,
}: SearchableSelectDropdownProps<T>) {
  return (
    <SearchPopoverSelect
      value={selectedValue ?? ""}
      options={options}
      placeholder={placeholder}
      searchPlaceholder={searchPlaceholder}
      align={align}
      contentClassName={cn("w-64", contentClassName)}
      onValueChange={(v) => onValueChange(v as T)}
      renderTrigger={({ labelRef, triggerText, onPointerEnter }) => (
        <Button
          variant={triggerVariant}
          size={triggerSize}
          className={cn(
            "w-full justify-between gap-2 border-grey-100 text-sm text-grey-300",
            selectedValue && "text-grey-800",
            className
          )}
          aria-label={ariaLabel}
          onPointerEnter={onPointerEnter}
        >
          <span ref={labelRef} className="min-w-0 truncate text-sm">
            {triggerText}
          </span>
          <ChevronDown className="size-4 shrink-0 opacity-60" />
        </Button>
      )}
    />
  );
}
