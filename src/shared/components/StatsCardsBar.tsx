import { cn } from "@/lib/utils";

type StatsCardItem = {
  key: string;
  label: string;
  value: string | number;
};

type StatsCardsBarProps = {
  items: StatsCardItem[];
  gridCols?: number;
};

export const StatsCardsBar = ({ items, gridCols = 4 }: StatsCardsBarProps) => (
  <div
    className={cn(
      "grid grid-cols-2 gap-2 divide-x divide-grey-50 overflow-hidden rounded-xl border border-grey-50 bg-white p-2 lg:grid-cols-4",
      gridCols === 2 && "lg:grid-cols-2",
      gridCols === 3 && "lg:grid-cols-3",
      gridCols === 4 && "lg:grid-cols-4",
      gridCols === 5 && "lg:grid-cols-5",
    )}
  >
    {items.map((item) => (
      <button
        key={item.key}
        type="button"
        className="hover-primary-shadow group flex flex-1 flex-col gap-1.5 rounded-xl border border-grey-50 px-3 py-3 text-left transition-colors hover:border-primary sm:px-6 sm:py-4"
      >
        <span className="inter text-body font-medium text-grey-500 group-hover:text-green-dark">
          {item.label}
        </span>
        <span className="text-stat-value text-grey-700 inter group-hover:text-green-dark">
          {typeof item.value === "number" ? item.value.toLocaleString() : item.value}
        </span>
      </button>
    ))}
  </div>
);
