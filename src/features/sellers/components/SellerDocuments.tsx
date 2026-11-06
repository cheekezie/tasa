import { useEffect, useRef, useState } from "react";
import { useSellerDocument, type SellerDocument } from "@/features/sellers/api";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/shared/ui/dialog";
import { Skeleton } from "@/shared/ui/skeleton";
import { ApiError } from "@/lib/http";

const TITLES: Record<SellerDocument, string> = { photo: "Selfie", id: "ID" };

/**
 * The selfie and the ID side by side, for compliance. Nothing loads until the officer asks
 * (every view is logged), and the images live only as object URLs in this component's state,
 * revoked on hide and on unmount.
 */
export function SellerDocuments({
  sellerId,
  idTypeLabel,
  submission,
  compact = false,
}: {
  sellerId: string;
  idTypeLabel: string | null;
  /** An earlier submission's id; without it, the current one. */
  submission?: string;
  /** Just the button until opened, for a list of earlier submissions. */
  compact?: boolean;
}) {
  const [shown, setShown] = useState(false);
  const photo = useSellerDocument(sellerId, "photo", submission);
  const id = useSellerDocument(sellerId, "id", submission);
  const [urls, setUrls] = useState<Partial<Record<SellerDocument, string>>>({});
  const created = useRef<string[]>([]);
  const [zoomed, setZoomed] = useState<SellerDocument | null>(null);

  // Whatever was created is released when the page goes, so no decrypted image outlives it.
  useEffect(
    () => () => {
      created.current.forEach((u) => URL.revokeObjectURL(u));
      created.current = [];
    },
    [],
  );

  const load = (kind: SellerDocument) => {
    const mutation = kind === "photo" ? photo : id;
    mutation.mutate(undefined, {
      onSuccess: (blob) => {
        const url = URL.createObjectURL(blob);
        created.current.push(url);
        setUrls((prev) => ({ ...prev, [kind]: url }));
        // The bytes are in the object URL now; don't keep a second copy in the mutation's state.
        mutation.reset();
      },
    });
  };

  const show = () => {
    setShown(true);
    load("photo");
    load("id");
  };

  const hide = () => {
    created.current.forEach((u) => URL.revokeObjectURL(u));
    created.current = [];
    setUrls({});
    setZoomed(null);
    photo.reset();
    id.reset();
    setShown(false);
  };

  if (!shown && compact) {
    return (
      <Button size="sm" variant="outline" onClick={show}>
        Show documents
      </Button>
    );
  }

  if (!shown) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-dashed border-grey-100 p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-grey-500">Each view is logged in the audit trail with your name, so only open them to make a decision.</p>
        <Button size="sm" variant="outline" className="shrink-0" onClick={show}>
          Show documents
        </Button>
      </div>
    );
  }

  const tiles: { kind: SellerDocument; caption: string; failed: boolean; error: unknown }[] = [
    { kind: "photo", caption: "Selfie", failed: photo.isError, error: photo.error },
    { kind: "id", caption: idTypeLabel ? `ID (${idTypeLabel})` : "ID", failed: id.isError, error: id.error },
  ];

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {tiles.map((t) => {
          const url = urls[t.kind];
          return (
            <figure key={t.kind} className="space-y-1.5">
              <figcaption className="text-xs font-medium text-grey-500">{t.caption}</figcaption>
              {url ? (
                <button
                  type="button"
                  onClick={() => setZoomed(t.kind)}
                  className="block w-full overflow-hidden rounded-lg border border-grey-50 bg-grey-25"
                  title="Open full size"
                >
                  <img src={url} alt={t.caption} className="h-64 w-full object-contain" />
                </button>
              ) : t.failed ? (
                <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-center text-sm">
                  <p className="text-destructive">
                    {t.error instanceof ApiError && t.error.status > 0 ? t.error.message : "Couldn't load this document."}
                  </p>
                  <button type="button" className="font-medium text-primary hover:underline" onClick={() => load(t.kind)}>
                    Try again
                  </button>
                </div>
              ) : (
                <Skeleton className="h-64 rounded-lg" />
              )}
            </figure>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-grey-400">Click an image to see it full size.</p>
        <Button size="sm" variant="ghost" onClick={hide}>
          Hide documents
        </Button>
      </div>

      <Dialog open={zoomed !== null} onOpenChange={(o) => !o && setZoomed(null)}>
        <DialogContent className="max-h-[90vh] sm:max-w-3xl md:max-w-4xl" aria-describedby={undefined}>
          <DialogTitle>{zoomed ? TITLES[zoomed] : ""}</DialogTitle>
          {zoomed && urls[zoomed] && <img src={urls[zoomed]} alt={TITLES[zoomed]} className="max-h-[78vh] w-full object-contain" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
