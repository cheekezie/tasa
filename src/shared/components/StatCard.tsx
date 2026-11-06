import { ArrowUp, ArrowDown, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import IconWrapper from "@/shared/components/IconWrapper";

interface SubStat {
  label: string;
  value: string | number;
  trend?: {
    direction: "up" | "down";
    value: string;
  };
}

interface StatCardProps {
  title: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  stats: SubStat[];
  highlighted?: boolean;
}

function SubStatCell({ label, value, trend }: SubStat) {
  const isUp = trend?.direction === "up";
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-grey-50 p-2">
      <p className="inter text-body text-grey-700 font-medium">{label}</p>
      <p className="text-stat-value text-grey-700 font-medium">{value}</p>
      {trend && (
        <div
          className={cn(
            "satoshi flex items-center gap-1 text-xs font-medium",
            isUp ? "text-success-400" : "text-[#E33B32]",
          )}
        >
          {isUp ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
          <span>{trend.value} vs last session</span>
        </div>
      )}
    </div>
  );
}

export default function StatCard({ title, icon: Icon, action, stats }: StatCardProps) {
  return (
    <div
      className={cn(
        "hover-primary-shadow flex flex-col gap-2 rounded-xl border border-grey-50 bg-white transition-all duration-300 hover:border-primary",
      )}
    >
      <div className="flex items-center justify-between border-b border-grey-50 p-2 pb-4">
        <div className="flex items-center gap-2">
          {Icon && (
            <IconWrapper className="h-9 w-9">
              <Icon className="size-4 text-grey-400" />
            </IconWrapper>
          )}
          <h3 className="text-body text-grey-700 cursor-pointer font-medium sm:text-base">{title}</h3>
        </div>
        {action}
      </div>

      <div className="grid grid-cols-1 gap-2 p-2 sm:grid-cols-2">
        {stats.map((stat, i) => (
          <SubStatCell key={i} {...stat} />
        ))}
      </div>
    </div>
  );
}
