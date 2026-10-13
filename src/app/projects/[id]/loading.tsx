import { Skeleton } from "@/components/ui/skeleton"
import { HeaderSkeleton, ListSkeleton } from "@/components/loading"

export default function Loading() {
  return (
    <div className="p-6 space-y-5" role="status" aria-busy="true" aria-label="頁面載入中…">
      <Skeleton className="h-4 w-24" />
      <HeaderSkeleton withControl />
      <div className="grid grid-cols-3 gap-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
      <ListSkeleton rows={5} variant="card" />
    </div>
  )
}
