import { RANGES, type RangeKey } from "@/lib/range";
import { cn } from "@/lib/utils";

/** Last 7 / 30 / 90 days. */
export function RangeTabs({ value, onChange }: { value: RangeKey; onChange: (key: RangeKey) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-grey-50 bg-white p-0.5">
      {(Object.keys(RANGES) as RangeKey[]).map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm transition-colors",
            value === key ? "bg-primary text-white" : "text-grey-500 hover:bg-grey-25",
          )}
        >
          Last {RANGES[key]} days
        </button>
      ))}
    </div>
  );
}
