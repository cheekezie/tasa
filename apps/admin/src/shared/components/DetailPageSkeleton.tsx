import { Skeleton } from "@/shared/ui/skeleton";

const SectionCardSkeleton = ({ rows = 6 }: { rows?: number }) => (
  <div className="rounded-xl border border-grey-50 bg-white p-3">
    <Skeleton className="mb-3 h-5 w-40 border-b border-grey-50 pb-2" />
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex justify-between">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-36" />
        </div>
      ))}
    </div>
  </div>
);

const DocumentRowSkeleton = () => (
  <div className="space-y-3 rounded-lg border border-grey-50 bg-white p-4">
    <Skeleton className="h-4 w-40" />
    <div className="flex items-center justify-between gap-3 rounded-lg border border-grey-50 px-3 py-2">
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-md" />
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-4 w-16 rounded-full" />
        </div>
      </div>
      <div className="flex gap-3">
        <Skeleton className="h-9 w-28 rounded-md" />
        <Skeleton className="size-9 rounded-md" />
      </div>
    </div>
  </div>
);

type DetailPageSkeletonProps = {
  sectionCount?: number;
  documentCount?: number;
  rowsPerSection?: number;
};

export function DetailPageSkeleton({
  sectionCount = 4,
  documentCount = 3,
  rowsPerSection = 6,
}: DetailPageSkeletonProps) {
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Skeleton className="size-5 rounded" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-24 rounded-md" />
          <Skeleton className="h-9 w-20 rounded-md" />
          <Skeleton className="h-9 w-28 rounded-md" />
        </div>
      </div>

      {/* Summary card */}
      <section className="rounded-xl border border-grey-50 bg-white p-2">
        <div className="flex items-center gap-3 rounded-lg border border-grey-50 p-3">
          <Skeleton className="size-[60px] shrink-0 rounded-md" />
          <div className="grid w-full grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Detail sections */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: sectionCount }).map((_, i) => (
          <SectionCardSkeleton key={i} rows={rowsPerSection} />
        ))}
      </section>

      {/* Documents */}
      <section className="space-y-3 rounded-xl border border-grey-50 bg-white p-4">
        <Skeleton className="h-5 w-28" />
        {Array.from({ length: documentCount }).map((_, i) => (
          <DocumentRowSkeleton key={i} />
        ))}
      </section>
    </div>
  );
}
