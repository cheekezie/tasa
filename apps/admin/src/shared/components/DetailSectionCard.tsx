import type { StatusVariant } from "@/shared/components/StatusBadge";
import StatusBadge from "@/shared/components/StatusBadge";
import type { ReactNode } from "react";

export type DetailRowItem = {
  label: string;
  value: ReactNode;
  type?: "status";
  variant?: StatusVariant;
  valueClassName?: string;
};

export type DetailSectionData = {
  title: string;
  rows: DetailRowItem[];
};

export const DetailRow = ({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: ReactNode;
  valueClassName?: string;
}) => (
  <div className="flex justify-between gap-2">
    <span className="text-body shrink-0 text-grey-300">{label}</span>
    <span className={`text-body ${valueClassName ?? "text-grey-800"}`}>{value}</span>
  </div>
);

export const DetailSectionCard = ({ title, rows }: DetailSectionData) => (
  <div className="rounded-xl border border-grey-50 bg-white p-3">
    <h2 className="text-section-title mb-3 border-b border-grey-50 pb-2 text-grey-800">
      {title}
    </h2>
    <div className="text-body space-y-2">
      {rows.map((row) =>
        row.type === "status" ? (
          <div key={row.label} className="flex justify-between gap-2">
            <span className="text-body shrink-0 text-grey-300">{row.label}</span>
            <StatusBadge variant={row.variant ?? "success"} label={row.value as string} />
          </div>
        ) : (
          <DetailRow
            key={row.label}
            label={row.label}
            value={row.value}
            valueClassName={`${row.valueClassName ?? "text-grey-800"} capitalize`}
          />
        ),
      )}
    </div>
  </div>
);
