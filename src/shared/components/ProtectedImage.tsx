import { useEffect, useRef, useState } from "react";
import type { UseMutationResult } from "@tanstack/react-query";
import { ApiError } from "@/lib/http";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/shared/ui/dialog";
import { Skeleton } from "@/shared/ui/skeleton";

/**
 * One private image (an ID card, a group's proof), for compliance. Same rules as organisers'
 * documents: nothing loads until the officer asks (every view is logged), and the image lives
 * only as an object URL in this component's state, revoked on hide and on unmount.
 */
export function ProtectedImage({
  title,
  showLabel,
  file,
}: {
  title: string;
  /** The button, e.g. "View ID card". */
  showLabel: string;
  /** A mutation that POSTs for the blob (see `useSellerDocument`). */
  file: UseMutationResult<Blob, unknown, void>;
}) {
  const [shown, setShown] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const created = useRef<string[]>([]);
  const [zoomed, setZoomed] = useState(false);

  useEffect(
    () => () => {
      created.current.forEach((u) => URL.revokeObjectURL(u));
      created.current = [];
    },
    [],
  );

  const load = () =>
    file.mutate(undefined, {
      onSuccess: (blob) => {
        const next = URL.createObjectURL(blob);
        created.current.push(next);
        setUrl(next);
        // The bytes are in the object URL now; don't keep a second copy in the mutation's state.
        file.reset();
      },
    });

  const show = () => {
    setShown(true);
    load();
  };

  const hide = () => {
    created.current.forEach((u) => URL.revokeObjectURL(u));
    created.current = [];
    setUrl(null);
    setZoomed(false);
    file.reset();
    setShown(false);
  };

  if (!shown) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-dashed border-grey-100 p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-grey-500">Each view is logged in the audit trail with your name, so only open it to make a decision.</p>
        <Button size="sm" variant="outline" className="shrink-0" onClick={show}>
          {showLabel}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <figure className="space-y-1.5">
        <figcaption className="text-xs font-medium text-grey-500">{title}</figcaption>
        {url ? (
          <button type="button" onClick={() => setZoomed(true)} className="block w-full overflow-hidden rounded-lg border border-grey-50 bg-grey-25" title="Open full size">
            <img src={url} alt={title} className="h-72 w-full object-contain" />
          </button>
        ) : file.isError ? (
          <div className="flex h-72 flex-col items-center justify-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-center text-sm">
            <p className="text-destructive">{file.error instanceof ApiError && file.error.status > 0 ? file.error.message : "Couldn't load this image."}</p>
            <button type="button" className="font-medium text-primary hover:underline" onClick={load}>
              Try again
            </button>
          </div>
        ) : (
          <Skeleton className="h-72 rounded-lg" />
        )}
      </figure>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-grey-400">Click the image to see it full size.</p>
        <Button size="sm" variant="ghost" onClick={hide}>
          Hide
        </Button>
      </div>

      <Dialog open={zoomed} onOpenChange={setZoomed}>
        <DialogContent className="max-h-[90vh] sm:max-w-3xl md:max-w-4xl" aria-describedby={undefined}>
          <DialogTitle>{title}</DialogTitle>
          {url && <img src={url} alt={title} className="max-h-[78vh] w-full object-contain" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
