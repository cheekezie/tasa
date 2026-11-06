import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** One number on a card: what it is, the figure, and a line of context. */
export function Metric({
  label,
  value,
  hint,
  tone = "default",
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "good" | "bad";
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-grey-50 bg-white p-4", className)}>
      <p className="text-sm text-grey-400">{label}</p>
      <p
        className={cn(
          "font-heading mt-1 text-2xl font-semibold",
          tone === "good" ? "text-success-500" : tone === "bad" ? "text-destructive" : "text-grey-800",
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-grey-400">{hint}</p>}
    </div>
  );
}

/** A titled white panel. `fill` makes it as tall as its row and lets the body take the space. */
export function Panel({
  title,
  actions,
  children,
  className,
  fill,
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  fill?: boolean;
}) {
  return (
    <section className={cn("rounded-xl border border-grey-50 bg-white", fill && "flex h-full flex-col", className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 border-b border-grey-50 px-4 py-3">
          {title && <h2 className="text-sm font-semibold text-grey-800">{title}</h2>}
          {actions}
        </div>
      )}
      <div className={cn("p-4", fill && "flex flex-1 flex-col")}>{children}</div>
    </section>
  );
}

/** For a query that failed: what went wrong, and a way to try again. */
export function LoadFailed({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm">
      <p className="font-medium text-destructive">This didn't load</p>
      <p className="mt-1 text-grey-500">{error instanceof Error ? error.message : "Something went wrong."}</p>
      <button type="button" onClick={onRetry} className="mt-2 font-medium text-primary hover:underline">
        Try again
      </button>
    </div>
  );
}
