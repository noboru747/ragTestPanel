"use client"

import { useEffect, useRef, useState } from "react"
import { formatCompact, formatInt, formatPoints, niceTicks, type UsageSummary } from "@/lib/usage"

type Day = UsageSummary["by_day"][number]
export type DailyMetric = "tokens" | "points"

const M = { top: 12, right: 8, bottom: 26, left: 44 }

/** 柱頂 4px 圓角、底部貼齊基線 */
function barPath(x: number, y: number, w: number, y0: number): string {
  const h = y0 - y
  const r = Math.max(0, Math.min(4, w / 2, h))
  return `M${x},${y0}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y0}Z`
}

function shortDate(d: string) {
  const [, m, day] = d.split("-")
  return `${Number(m)}/${Number(day)}`
}

/**
 * 每日用量直條圖（單一系列：tokens 或點數）。
 * - 每根柱子就是 hover 目標（整個欄寬都可觸發），鍵盤可用 ← → 逐日查看
 * - Tooltip 只是加強；數值另有表格檢視（由頁面提供）
 */
export function DailyUsageChart({
  data,
  metric,
  height = 220,
}: {
  data: Day[]
  metric: DailyMetric
  height?: number
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  const [active, setActive] = useState<number | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const update = () => setWidth(Math.max(240, Math.floor(el.clientWidth)))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const values = data.map((d) => (metric === "tokens" ? d.total_tokens : d.points))
  const max = Math.max(0, ...values)
  const ticks = niceTicks(max)
  const yMax = ticks[ticks.length - 1] || 1
  const plotW = width - M.left - M.right
  const plotH = height - M.top - M.bottom
  const y0 = M.top + plotH
  const n = Math.max(1, data.length)
  const band = plotW / n
  // ≤24px，且相鄰柱子間至少留 2px 表面間隙
  const barW = Math.max(1, Math.min(24, band * 0.72, band - 2))
  const yOf = (v: number) => M.top + plotH - (v / yMax) * plotH
  const fmt = metric === "tokens" ? formatCompact : formatPoints
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 56))))

  const a = active != null ? data[active] : null
  const ax = active != null ? M.left + band * active + band / 2 : 0
  // 靠左／靠右時改變錨點，避免 tooltip 超出卡片被裁切
  const tipShift = ax > width * 0.7 ? "-100%" : ax < width * 0.3 ? "0%" : "-50%"

  return (
    <div ref={wrapRef} className="relative w-full select-none">
      <svg
        width={width}
        height={height}
        role="img"
        tabIndex={0}
        aria-label={`每日${metric === "tokens" ? " tokens" : "點數"}，共 ${data.length} 天，最高 ${fmt(max)}。可用左右方向鍵逐日查看。`}
        className="block outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        onPointerLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
        onFocus={() => setActive((v) => v ?? data.length - 1)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setActive((v) => Math.max(0, (v ?? data.length) - 1))
          else if (e.key === "ArrowRight") setActive((v) => Math.min(data.length - 1, (v ?? -1) + 1))
          else return
          e.preventDefault()
        }}
      >
        {/* 格線＋Y 軸刻度（髮絲線、實線） */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={M.left}
              x2={width - M.right}
              y1={yOf(t)}
              y2={yOf(t)}
              stroke={t === 0 ? "var(--viz-baseline)" : "var(--viz-grid)"}
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
            <text
              x={M.left - 6}
              y={yOf(t)}
              dy="0.32em"
              textAnchor="end"
              fontSize={10}
              fill="var(--viz-muted)"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {fmt(t)}
            </text>
          </g>
        ))}

        {/* 柱子 */}
        {data.map((d, i) => {
          const v = values[i]
          if (!(v > 0)) return null
          const x = M.left + band * i + (band - barW) / 2
          const y = Math.min(yOf(v), y0 - 1) // 極小值至少 1px 可見
          return (
            <path
              key={d.date}
              d={barPath(x, y, barW, y0)}
              fill="var(--viz-series-1)"
              opacity={active == null || active === i ? 1 : 0.55}
            />
          )
        })}

        {/* X 軸日期（稀疏標示） */}
        {data.map((d, i) =>
          i % labelEvery === (n - 1) % labelEvery ? (
            <text
              key={`x-${d.date}`}
              x={M.left + band * i + band / 2}
              y={y0 + 16}
              textAnchor="middle"
              fontSize={10}
              fill="var(--viz-muted)"
            >
              {shortDate(d.date)}
            </text>
          ) : null
        )}

        {/* 命中區：整個欄寬＋整個繪圖高度 */}
        {data.map((d, i) => (
          <rect
            key={`hit-${d.date}`}
            x={M.left + band * i}
            y={M.top}
            width={band}
            height={plotH}
            fill="transparent"
            onPointerEnter={() => setActive(i)}
            onPointerDown={() => setActive(i)}
          />
        ))}
      </svg>

      {a && (
        <div
          role="status"
          className="pointer-events-none absolute top-0 z-10 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md whitespace-nowrap"
          style={{ left: ax, transform: `translateX(${tipShift})` }}
        >
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-3 rounded" style={{ background: "var(--viz-series-1)" }} />
            <span className="font-semibold text-foreground">
              {metric === "tokens" ? `${formatInt(a.total_tokens)} tokens` : `${formatPoints(a.points)} 點`}
            </span>
          </div>
          <div className="text-muted-foreground mt-0.5">
            {a.date} · {formatInt(a.calls)} 次呼叫
            {metric === "tokens" ? ` · ${formatPoints(a.points)} 點` : ` · ${formatCompact(a.total_tokens)} tokens`}
          </div>
        </div>
      )}
    </div>
  )
}
