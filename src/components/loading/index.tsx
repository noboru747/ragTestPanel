import { Loader2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

/**
 * 共用「載入中」元件。動畫在 prefers-reduced-motion 時由 globals.css 降級
 * （pulse 停止、spin 放慢），這裡不需個別處理。
 */

/** 行內 spinner＋文字，例如按鈕內「查詢中…」或區塊內「載入中…」 */
export function InlineSpinner({
  label,
  className,
  iconClassName,
}: {
  label?: React.ReactNode
  className?: string
  iconClassName?: string
}) {
  return (
    <span role="status" aria-live="polite" className={cn("inline-flex items-center gap-1.5", className)}>
      <Loader2 className={cn("h-4 w-4 animate-spin shrink-0", iconClassName)} aria-hidden />
      {label != null && <span>{label}</span>}
    </span>
  )
}

/** 置中的區塊載入提示（用於整塊內容尚未就緒） */
export function LoadingBlock({ label = "資料載入中…", className }: { label?: string; className?: string }) {
  return (
    <div className={cn("flex items-center justify-center py-10 text-sm text-muted-foreground", className)}>
      <InlineSpinner label={label} />
    </div>
  )
}

/** 清單骨架：card = 卡片列（專案/文件），row = 緊湊列，grid2 = 兩欄卡片 */
export function ListSkeleton({
  rows = 4,
  variant = "card",
  className,
  label = "資料載入中…",
}: {
  rows?: number
  variant?: "card" | "row" | "grid2"
  className?: string
  label?: string
}) {
  const items = Array.from({ length: rows }, (_, i) => i)
  return (
    <div role="status" aria-busy="true" aria-label={label} className={className}>
      <span className="sr-only">{label}</span>
      {variant === "row" ? (
        <div className="space-y-2">
          {items.map((i) => (
            <div key={i} className="flex items-center gap-3 rounded-md border px-3 py-2.5">
              <Skeleton className="h-4 w-4 rounded-full" />
              <Skeleton className="h-3.5 flex-1 max-w-[60%]" />
              <Skeleton className="h-3.5 w-16 ml-auto" />
            </div>
          ))}
        </div>
      ) : (
        <div className={cn(variant === "grid2" ? "grid grid-cols-1 gap-4 lg:grid-cols-2" : "space-y-2")}>
          {items.map((i) => (
            <Card key={i}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-4" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

/** 表格骨架 */
export function TableSkeleton({ rows = 5, cols = 5, className }: { rows?: number; cols?: number; className?: string }) {
  return (
    <Card className={className}>
      <CardContent className="p-0" role="status" aria-busy="true" aria-label="資料載入中…">
        <span className="sr-only">資料載入中…</span>
        <div className="flex gap-4 bg-muted/50 px-3 py-2.5">
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} className="h-3 flex-1 bg-muted-foreground/15" />
          ))}
        </div>
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex gap-4 border-t px-3 py-3">
            {Array.from({ length: cols }, (_, c) => (
              <Skeleton key={c} className={cn("h-3.5 flex-1", c === 0 && "max-w-[120px]")} />
            ))}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

/** 統計卡骨架 */
export function StatCardsSkeleton({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 gap-4 lg:grid-cols-4", className)}>
      {Array.from({ length: count }, (_, i) => (
        <Card key={i}>
          <CardContent className="p-4 flex items-center gap-4">
            <Skeleton className="h-9 w-9 rounded-lg" />
            <div className="space-y-2 flex-1">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-6 w-10" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

/** 頁首骨架（標題＋副標，可選右側控制項） */
export function HeaderSkeleton({ withControl = false }: { withControl?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      {withControl && <Skeleton className="h-8 w-44" />}
    </div>
  )
}

/** 通用頁面骨架：給 loading.tsx 使用 */
export function PageSkeleton({
  withControl = false,
  stats = 0,
  list = "card",
  rows = 4,
}: {
  withControl?: boolean
  stats?: number
  list?: "card" | "row" | "grid2" | "table" | "none"
  rows?: number
}) {
  return (
    <div className="p-6 space-y-5">
      <HeaderSkeleton withControl={withControl} />
      {stats > 0 && <StatCardsSkeleton count={stats} />}
      {list === "table" ? (
        <TableSkeleton rows={rows} />
      ) : list !== "none" ? (
        <ListSkeleton rows={rows} variant={list} />
      ) : null}
    </div>
  )
}
