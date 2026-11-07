import { useState } from "react";
import type { School } from "@/features/students/api";
import { cn } from "@/lib/utils";

/** The school's crest on white, or the first letters of its short name without one. */
export function SchoolLogo({
  school,
  className,
}: {
  school: Pick<School, "shortName" | "logoUrl">;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      className={cn(
        "grid size-8 shrink-0 place-items-center overflow-hidden rounded-md bg-white ring-1 ring-grey-50",
        className
      )}
    >
      {school.logoUrl && !failed ? (
        <img
          src={school.logoUrl}
          alt=""
          className="size-[85%] object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="text-[10px] font-semibold text-grey-500">
          {school.shortName.slice(0, 3)}
        </span>
      )}
    </span>
  );
}
