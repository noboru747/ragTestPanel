import { Skeleton } from "@/components/ui/skeleton"
import { HeaderSkeleton } from "@/components/loading"

export default function Loading() {
  return (
    <div className="flex flex-col h-screen" role="status" aria-busy="true" aria-label="頁面載入中…">
      <div className="p-6 pb-3 border-b">
        <HeaderSkeleton withControl />
      </div>
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
        <Skeleton className="h-16 w-16 rounded-full" />
        <Skeleton className="h-4 w-40" />
        <div className="grid w-full max-w-lg gap-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
      <div className="p-4 border-t">
        <Skeleton className="mx-auto h-11 max-w-3xl" />
      </div>
    </div>
  )
}
