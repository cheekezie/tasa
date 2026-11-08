import { cn } from "@/lib/utils";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { type IconSvgElement } from "@/shared/ui/icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { type ComponentProps, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";

export type RowAction = {
  label: string;
  onClick: () => void;
  icon?: IconSvgElement;
  color?: string;
  disabled?: boolean;
  /** Use the destructive styling baked into the dropdown item. */
  variant?: "default" | "destructive";
  /** Hide the action entirely (useful for permission-gated rows). */
  hidden?: boolean;
  /** Stable key; falls back to the label when omitted. */
  key?: string;
  /** Extra classes for the individual item. */
  className?: string;
};

type RowActionsMenuProps = {
  actions: RowAction[];
  /** Custom trigger element. Defaults to a "more" icon button. */
  trigger?: ReactNode;
  /** Accessible label for the default trigger button. */
  triggerLabel?: string;
  /** Extra classes for the default trigger button. */
  triggerClassName?: string;
  /** Extra classes for the dropdown content. */
  contentClassName?: string;
  align?: ComponentProps<typeof DropdownMenuContent>["align"];
};

export function RowActionsMenu({
  actions,
  trigger,
  triggerLabel = "Open row actions",
  triggerClassName,
  contentClassName,
  align = "end",
}: RowActionsMenuProps) {
  const visibleActions = actions.filter((action) => !action.hidden);

  if (visibleActions.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {trigger ?? (
          <Button
            variant="outline"
            size="icon-sm"
            className={triggerClassName}
            aria-label={triggerLabel}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        className={cn("w-61 space-y-1 rounded-sm", contentClassName)}
      >
        {visibleActions.map((action) => (
          <DropdownMenuItem
            key={action.key ?? action.label}
            variant={action.variant ?? "default"}
            disabled={Boolean(action.disabled)}
            onClick={action.onClick}
            className={cn("py-3", action.className)}
            style={action.color ? { color: action.color } : undefined}
          >
            {action.icon ? (
              <HugeiconsIcon
                icon={action.icon}
                className={cn("size-4", !action.color && "text-grey-300")}
                style={action.color ? { color: action.color } : undefined}
              />
            ) : null}
            <span className="text-body">{action.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default RowActionsMenu;
