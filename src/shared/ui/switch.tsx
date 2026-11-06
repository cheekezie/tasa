import * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default";
}) {
  const isSmall = size === "sm";

  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer relative inline-flex shrink-0 items-center rounded-full border border-transparent transition-all outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 data-disabled:cursor-not-allowed data-disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-grey-200",
        isSmall ? "h-[14px] w-[24px]" : "h-[16.6px] w-[28px]",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block rounded-full bg-white ring-0 transition-transform data-[state=unchecked]:translate-x-0",
          isSmall
            ? "size-3 data-[state=checked]:translate-x-[10px]"
            : "size-3.5 data-[state=checked]:translate-x-[12px]",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
