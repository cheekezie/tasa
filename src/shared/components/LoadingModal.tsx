import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/shared/ui/dialog";

interface LoadingModalProps {
  open: boolean;
  title?: string;
  description?: string;
}

/**
 * Blocking, non-dismissable modal with a spinner and text. Use for in-flight
 * actions the user must wait on (exports, bulk operations, etc.).
 */
export function LoadingModal({
  open,
  title = "Please wait",
  description = "Processing your request…",
}: LoadingModalProps) {
  return (
    <Dialog open={open}>
      <DialogContent
        showCloseButton={false}
        className="max-w-xs"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <Loader2 className="size-8 animate-spin text-primary" />
          <div className="space-y-1">
            <DialogTitle className="text-base font-medium text-grey-700">
              {title}
            </DialogTitle>
            <DialogDescription className="text-sm text-grey-400">
              {description}
            </DialogDescription>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
