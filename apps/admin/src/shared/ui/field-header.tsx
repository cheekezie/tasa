import * as React from "react";
import { cn } from "@/lib/utils";
import { FieldLabel } from "@/shared/ui/field";

export interface FieldHeaderProps {
  label?: React.ReactNode;
  topRightElement?: React.ReactNode;
  htmlFor?: string;
  className?: string;
}

function FieldHeader({ label, topRightElement, htmlFor, className }: FieldHeaderProps) {
  if (!label && !topRightElement) return null;

  return (
    <div className={cn("flex items-center justify-between gap-2", className)}>
      {label && <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>}
      {topRightElement}
    </div>
  );
}

export { FieldHeader };
