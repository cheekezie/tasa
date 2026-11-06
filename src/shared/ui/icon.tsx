import { HugeiconsIcon, type HugeiconsIconProps, type IconSvgElement } from "@hugeicons/react";
import { cn } from "@/lib/utils";

/**
 * Design-system-aware icon wrapper around HugeiconsIcon.
 *
 * Usage:
 *   import { Icon } from '@/shared/ui/icon'
 *   import { Add01Icon } from '@hugeicons/core-free-icons'
 *
 *   <Icon icon={Add01Icon} />
 *   <Icon icon={Add01Icon} size={20} className="text-primary" />
 */

export interface IconProps extends Omit<HugeiconsIconProps, "icon"> {
  icon: IconSvgElement;
  /** Utility classes forwarded to the root <svg> */
  className?: string;
}

export function Icon({ icon, size = 20, strokeWidth = 1.5, className, ...props }: IconProps) {
  return (
    <HugeiconsIcon
      icon={icon}
      size={size}
      strokeWidth={strokeWidth}
      className={cn("shrink-0", className)}
      {...props}
    />
  );
}

/**
 * Re-export the raw type so consumers don't need to import from @hugeicons/react directly.
 */
export type { IconSvgElement };
