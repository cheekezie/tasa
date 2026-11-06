import { cn } from "@/lib/utils";
import React from "react";

export default function IconWrapper({
  children,
  className,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <button
      className={cn(
        "flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full border border-grey-50 bg-grey-25 transition-colors hover:bg-grey-50",
        className,
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
