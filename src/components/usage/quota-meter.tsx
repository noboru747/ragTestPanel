"use client"

import { AlertTriangle, CheckCircle2, OctagonAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatPoints, quotaLevel, remainingRatio, type UsageQuota } from "@/lib/usage"

const LEVEL = {
  ok: { fill: "var(--viz-series-1)", icon: CheckCircle2, label: "充足", ink: "text-muted-foreground" },
  low: { fill: "var(--viz-status-warning)", icon: AlertTriangle, label: "偏低", ink: "text-amber-700 dark:text-amber-400" },
  critical: { fill: "var(--viz-status-critical)", icon: OctagonAlert, label: "告急", ink: "text-red-700 dark:text-red-400" },
} as const

/**
 * 剩餘點數 meter：填色表示嚴重度（正常→偏低→告急），軌道是同色階較淺一階。
 * 狀態一律搭配圖示＋文字，不只靠顏色。
 */
export function QuotaMeter({
  quota,
  size = "md",
  className,
}: {
  quota: UsageQuota | null | undefined
  size?: "sm" | "md"
  className?: string
}) {
  const ratio = remainingRatio(quota)
  if (ratio == null || !quota) {
    return <p className={cn("text-xs text-muted-foreground", className)}>尚未取得點數額度</p>
  }
  const level = LEVEL[quotaLevel(ratio) ?? "ok"]
  const Icon = level.icon
  const pct = Math.round(ratio * 1000) / 10
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline gap-1.5 flex-wrap">
        <span className={cn("font-semibold", size === "md" ? "text-2xl" : "text-xl")}>
          {formatPoints(quota.points_remaining)}
        </span>
        <span className="text-sm text-muted-foreground">/ {formatPoints(quota.points_total)} 點</span>
        <span className={cn("ml-auto inline-flex items-center gap-1 text-xs", level.ink)}>
          <Icon className="h-3.5 w-3.5" aria-hidden />
          剩 {pct}%（{level.label}）
        </span>
      </div>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={`剩餘點數 ${pct}%`}
        className={cn("w-full overflow-hidden rounded-full", size === "md" ? "h-2" : "h-1.5")}
        style={{ background: "var(--viz-series-1-track)" }}
      >
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, background: level.fill }}
        />
      </div>
    </div>
  )
}
