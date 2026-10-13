import { Skeleton } from "@/components/ui/skeleton"
import { HeaderSkeleton, ListSkeleton } from "@/components/loading"

export default function Loading() {
  return (
    <div className="p-6 space-y-5" role="status" aria-busy="true" aria-label="頁面載入中…">
      <HeaderSkeleton />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-14" />
        ))}
      </div>
      <Skeleton className="h-64 w-full rounded-xl" />
      <ListSkeleton rows={2} variant="row" />
    </div>
  )
}
