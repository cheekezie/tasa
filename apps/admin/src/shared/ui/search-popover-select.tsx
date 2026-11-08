import { useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/shared/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { useScrollLockEscape } from "@/shared/hooks/useScrollLockEscape";

export type SearchPopoverOption = {
  label: string;
  value: string;
  disabled?: boolean;
};

export type SearchPopoverTriggerProps = {
  labelRef: React.RefObject<HTMLSpanElement | null>;
  triggerText: string;
  onPointerEnter: () => void;
};

type SearchPopoverSelectProps = {
  value: string;
  options: SearchPopoverOption[];
  placeholder?: string | undefined;
  searchPlaceholder?: string | undefined;
  disabled?: boolean | undefined;
  align?: "start" | "center" | "end" | undefined;
  contentClassName?: string | undefined;
  onValueChange: (value: string) => void;
  renderTrigger: (props: SearchPopoverTriggerProps) => React.ReactNode;
};

export function SearchPopoverSelect({
  value,
  options,
  placeholder = "Select",
  searchPlaceholder = "Search…",
  disabled,
  align = "start",
  contentClassName,
  onValueChange,
  renderTrigger,
}: SearchPopoverSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const labelRef = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);
  const scrollRef = useScrollLockEscape<HTMLDivElement>();

  const triggerText = useMemo(
    () => options.find((o) => o.value === value)?.label ?? placeholder,
    [options, value, placeholder]
  );

  const filtered = options.filter((o) =>
    o.label.toLowerCase().includes(query.trim().toLowerCase())
  );

  const select = (nextValue: string) => {
    onValueChange(nextValue);
    setOpen(false);
    setQuery("");
  };

  const onPointerEnter = () => {
    const el = labelRef.current;
    if (el) setTruncated(el.scrollWidth > el.clientWidth);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (!disabled) setOpen(nextOpen);
      }}
    >
      <Tooltip {...(truncated ? {} : { open: false })}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            {renderTrigger({ labelRef, triggerText, onPointerEnter })}
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{triggerText}</TooltipContent>
      </Tooltip>

      <PopoverContent
        align={align}
        className={cn(
          "block space-y-1 p-1",
          contentClassName ?? "w-(--radix-popover-trigger-width)"
        )}
      >
        <Input
          className="mb-1"
          placeholder={searchPlaceholder}
          leftSlot={<Search size={15} />}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="">
          <div ref={scrollRef} className="max-h-[200px] min-h-0 space-y-1 overflow-y-auto">
            {filtered.map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={option.disabled}
                className={cn(
                  "w-full truncate rounded-md px-3 py-3 text-left text-sm transition-colors hover:bg-grey-25 disabled:cursor-not-allowed disabled:opacity-50",
                  value === option.value && "bg-primary/5 font-medium text-primary"
                )}
                onClick={() => select(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          {filtered.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-grey-300">
              No matches found.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
