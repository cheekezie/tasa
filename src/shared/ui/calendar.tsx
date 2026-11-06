import { DayPicker } from "react-day-picker";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3 px-10", className)}
      classNames={{
        months: "flex flex-col sm:flex-row gap-4",
        month: "flex flex-col gap-4",
        month_caption: "flex justify-center pt-1 relative items-center w-full",
        caption_label: "text-sm font-medium text-grey-800",
        nav: "flex items-center gap-1",
        button_previous: cn(
          "absolute left-1 h-7 w-7 flex items-center justify-center rounded-md border border-grey-100",
          "text-grey-400 hover:bg-grey-50 hover:text-grey-800 transition-colors"
        ),
        button_next: cn(
          "absolute right-1 h-7 w-7 flex items-center justify-center rounded-md border border-grey-100",
          "text-grey-400 hover:bg-grey-50 hover:text-grey-800 transition-colors"
        ),
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday:
          "text-grey-400 rounded-md w-9 font-normal text-[0.8rem] text-center pb-1",
        week: "flex w-full mt-2",
        day: "relative p-0 text-center text-sm focus-within:relative focus-within:z-20 [&:has([aria-selected])]:bg-green-92 [&:has([aria-selected].range-end)]:rounded-r-md [&:has([aria-selected].range-start)]:rounded-l-md first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md",
        day_button: cn(
          "h-9 w-9 p-0 font-normal text-grey-800 rounded-md",
          "hover:bg-green-92 hover:text-grey-800 transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          "aria-selected:opacity-100"
        ),
        range_start:
          "range-start day-range-start aria-selected:bg-primary aria-selected:text-primary-foreground aria-selected:rounded-md",
        range_end:
          "range-end day-range-end aria-selected:bg-primary aria-selected:text-primary-foreground aria-selected:rounded-md",
        selected:
          "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground rounded-md",
        today: "bg-green-92 text-grey-800 rounded-md font-semibold",
        outside: "text-grey-200 aria-selected:text-grey-400",
        disabled: "text-grey-200 opacity-50",
        range_middle:
          "aria-selected:bg-green-92 aria-selected:text-grey-800 aria-selected:rounded-none",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) =>
          orientation === "left" ? (
            <ChevronLeft className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          ),
      }}
      {...props}
    />
  );
}

export { Calendar };
