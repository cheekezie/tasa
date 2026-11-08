/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState } from "react";
import { useMediaQuery } from "@/shared/hooks/useMediaQuery";
import {
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  startOfMonth,
  startOfWeek,
  subDays,
} from "date-fns";
import { ArrowRight, Calendar1, X } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { Calendar } from "@/shared/ui/calendar";
import { Popover, PopoverTrigger, PopoverContent } from "@/shared/ui/popover";
import { Button } from "@/shared/ui/button";
import { cn } from "@/lib/utils";

interface DateRangePickerProps {
  className?: string;
  value?: DateRange | undefined;
  onRangeChange?: (range: DateRange | undefined) => void;
  onClear?: () => void;
  size?: React.ComponentProps<typeof Button>["size"];
}

export default function DateRangePicker({
  className,
  value,
  onRangeChange,
  onClear,
  size = "default",
}: DateRangePickerProps) {
  const [internalRange, setInternalRange] = useState<DateRange | undefined>(value);
  const [open, setOpen] = useState(false);
  const isTabletUp = useMediaQuery("(min-width: 768px)");

  useEffect(() => {
    setInternalRange(value);
  }, [value]);

  const range = internalRange;
  const hasRange = !!(range?.from || range?.to);

  const presets = useMemo(() => {
    const now = new Date();
    return [
      { label: "Today", range: { from: now, to: now } },
      {
        label: "This week",
        range: {
          from: startOfWeek(now, { weekStartsOn: 1 }),
          to: endOfWeek(now, { weekStartsOn: 1 }),
        },
      },
      {
        label: "This month",
        range: { from: startOfMonth(now), to: endOfMonth(now) },
      },
      {
        label: "Last 7 days",
        range: { from: subDays(now, 6), to: now },
      },
      {
        label: "Last 30 days",
        range: { from: subDays(now, 29), to: now },
      },
    ];
  }, []);

  function handleSelect(next: DateRange | undefined) {
    setInternalRange(next);
    onRangeChange?.(next);
    if (next?.from && next?.to) setOpen(false);
  }

  function applyPreset(preset: { range: Required<DateRange> }) {
    setInternalRange(preset.range);
    onRangeChange?.(preset.range);
    setOpen(false);
  }

  function isPresetActive(preset: { range: Required<DateRange> }) {
    return !!(
      range?.from &&
      range?.to &&
      isSameDay(range.from, preset.range.from ?? new Date()) &&
      isSameDay(range.to, preset.range.to ?? new Date())
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size={size}
          className={cn(
            "gap-2 border-grey-100 bg-white",
            hasRange && "border-primary/40 bg-primary/5",
            className
          )}
        >
          <Calendar1
            className={cn("size-4 shrink-0", hasRange ? "text-primary" : "text-grey-400")}
          />
          <div className="flex items-center gap-1.5 text-sm">
            <span className={range?.from ? "text-grey-700" : "text-grey-300"}>
              {range?.from ? format(range.from, "MMM d, yyyy") : "Start date"}
            </span>
            <ArrowRight className="size-3 shrink-0 text-grey-200" />
            <span className={range?.to ? "text-grey-700" : "text-grey-300"}>
              {range?.to ? format(range.to, "MMM d, yyyy") : "End date"}
            </span>
          </div>
          {onClear && hasRange && (
            <span
              role="button"
              tabIndex={0}
              aria-label="Clear date filter"
              className="hover:text-grey-600 ml-auto rounded p-0.5 text-grey-400 transition-colors hover:bg-grey-50"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setInternalRange(undefined);
                onClear();
              }}
            >
              <X className="size-4" />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <div className="flex flex-col md:flex-row">
          <div className="ml-6 flex flex-row gap-1 overflow-x-auto border-b border-grey-50 p-2 md:flex-col md:border-r md:border-b-0">
            {presets.map((preset) => (
              <button
                key={preset.label}
                className={cn(
                  "text-grey-600 rounded-md px-6 py-2 text-left text-sm whitespace-nowrap transition-colors hover:bg-grey-50",
                  isPresetActive(preset) && "bg-primary/5 font-medium text-primary"
                )}
                onClick={() => applyPreset(preset)}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <Calendar
            mode="range"
            min={1}
            selected={range}
            onSelect={handleSelect}
            numberOfMonths={isTabletUp ? 2 : 1}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
