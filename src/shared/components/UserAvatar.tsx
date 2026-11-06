import { useState } from "react";
import { cn } from "@/lib/utils";

const SIZES = { sm: "size-8 text-xs", md: "size-10 text-sm", lg: "size-14 text-lg" } as const;

/**
 * A person's profile photo, round, or their initials when they haven't added one (or it won't
 * load). Organisations use their square logo instead, so the two never look alike.
 */
export function UserAvatar({ url, name, size = "md", className }: { url: string | null | undefined; name: string; size?: keyof typeof SIZES; className?: string }) {
  const [failed, setFailed] = useState(false);
  const initials =
    name
      .replace(/^@/, "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "?";
  return url && !failed ? (
    <img src={url} alt="" onError={() => setFailed(true)} className={cn(SIZES[size], "shrink-0 rounded-full border border-grey-50 object-cover", className)} />
  ) : (
    <span className={cn(SIZES[size], "flex shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary", className)} aria-hidden>
      {initials}
    </span>
  );
}
