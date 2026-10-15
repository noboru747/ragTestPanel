"use client"

export const runtime = 'edge'

import { useCallback, useEffect, useRef, useState } from "react"
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Gauge,
  Info,
  OctagonAlert,
  RefreshCw,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { BackendErrorBanner } from "@/components/backend-error-banner"
import { InlineSpinner, StatCardsSkeleton } from "@/components/loading"
import { QuotaMeter } from "@/components/usage/quota-meter"
import { DailyUsageChart, type DailyMetric } from "@/components/usage/daily-usage-chart"
import { fetchJson } from "@/lib/backend-fetch"
import { cn } from "@/lib/utils"
import {
  USAGE_PERIODS,
  daysUntil,
  fillDays,
  forecastDays,
  formatCompact,
  formatInt,
  formatLatency,
  formatPoints,
  normalizeSummary,
  operationLabel,
  providerBillable,
  providerLabel,
  type UsageSummary,
} from "@/lib/usage"

type ProjectOption = { id: string; name: string }

/** 單選分段按鈕（期間、tokens/點數切換） */
function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  disabled,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  label: string
  disabled?: boolean
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border bg-background p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded px-2.5 py-1 text-xs transition-colors disabled:cursor-wait",
            value === o.value
              ? "bg-primary text-primary-foreground font-medium"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function StatTile({
  label,
  value,
  sub,
  className,
}: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  className?: string
}) {
  return (
    <Card className={className}>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold mt-1">{value}</p>
        {sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  )
}

function ProviderBadge({ provider }: { provider: string }) {
  const billable = providerBillable(provider)
  return (
    <Badge
      variant="outline"
      className={cn("text-[10px] px-1.5 py-0 shrink-0", !billable && "text-muted-foreground")}
      title={billable ? "AI 平台推論，計點" : "本機 Ollama，不計點"}
    >
      {providerLabel(provider)}
    </Badge>
  )
}

/** 水平長條（單一色相；數值標在柱尾外側，文字使用文字色） */
function HBar({ ratio }: { ratio: number }) {
  return (
    <div className="h-2 w-full rounded-r-[4px] bg-transparent">
      <div
        className="h-full rounded-r-[4px]"
        style={{ width: `${Math.max(ratio > 0 ? 1 : 0, ratio * 100)}%`, background: "var(--viz-series-1)" }}
      />
    </div>
  )
}

const TH = "px-3 py-2 text-left text-[11px] font-medium text-muted-foreground whitespace-nowrap"
const TD = "px-3 py-2 whitespace-nowrap"
const NUM = "text-right tabular-nums"

function UsageBody({
  data,
  days,
  projectId,
  metric,
  setMetric,
}: {
  data: UsageSummary
  days: number
  projectId: string
  metric: DailyMetric
  setMetric: (m: DailyMetric) => void
}) {
  const { quota, totals } = data
  const series = fillDays(data.by_day, days)
  const daysLeft = daysUntil(quota?.period_end)
  // 預估以全平台速度計算；有專案篩選時 by_day 只含該專案，不做預估
  const forecast = projectId ? null : forecastDays(quota?.points_remaining, data.by_day)
  const isEmpty = totals.calls === 0 && data.recent.length === 0
  const opMax = Math.max(0, ...data.by_operation.map((o) => o.total_tokens))
  const opSum = data.by_operation.reduce((s, o) => s + o.total_tokens, 0)
  const modelMax = Math.max(0, ...data.by_model.map((m) => m.total_tokens))
  const failRate = totals.calls > 0 ? (totals.failed_calls / totals.calls) * 100 : 0
  const tpp = quota?.tokens_per_point

  return (
    <>
      {/* KPI 列 */}
      <div className="grid grid-cols-1 gap-4 @md:grid-cols-2 @4xl:grid-cols-5">
        <Card className="@md:col-span-2">
          <CardContent className="p-4 space-y-2">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              剩餘點數
              {quota?.provider && <span>· {quota.provider}</span>}
              {projectId && <span>（全平台額度，不受專案篩選影響）</span>}
            </p>
            <QuotaMeter quota={quota} />
            <div className="text-[11px] text-muted-foreground space-y-0.5">
              {daysLeft != null && (
                <p>
                  本期剩 {daysLeft} 天
                  {quota?.period_end && <>（至 {String(quota.period_end).slice(0, 10)}）</>}
                </p>
              )}
              {forecast != null && (
                <p
                  className={cn(
                    "flex items-center gap-1",
                    daysLeft != null && forecast < daysLeft && "text-amber-700 dark:text-amber-400"
                  )}
                >
                  {daysLeft != null && forecast < daysLeft && <AlertTriangle className="h-3 w-3 shrink-0" />}
                  以目前速度預估可用 {forecast.toLocaleString()} 天
                  {daysLeft != null && forecast < daysLeft && "，將早於期末用完"}
                </p>
              )}
              {quota && (
                <p>
                  本期已用 {formatPoints(quota.points_used)} 點
                  {tpp ? ` · 1 點 = ${formatCompact(tpp)} tokens` : ""}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
        <StatTile
          label={`近 ${days} 天 tokens`}
          value={formatCompact(totals.total_tokens)}
          sub={
            <>
              輸入 {formatCompact(totals.prompt_tokens)} · 輸出 {formatCompact(totals.completion_tokens)}
              <br />約 {formatPoints(totals.points)} 點
            </>
          }
        />
        <StatTile
          label="呼叫次數"
          value={formatInt(totals.calls)}
          sub={totals.estimated_calls > 0 ? `其中 ${formatInt(totals.estimated_calls)} 次為估算` : "全部為平台回報數值"}
        />
        <StatTile
          label="失敗次數"
          value={formatInt(totals.failed_calls)}
          sub={
            totals.failed_calls > 0 ? (
              <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-400">
                <OctagonAlert className="h-3 w-3" />
                失敗率 {failRate.toFixed(1)}%
              </span>
            ) : totals.calls > 0 ? (
              <span className="inline-flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-green-600" />
                全部成功
              </span>
            ) : (
              "—"
            )
          }
        />
      </div>

      {isEmpty ? (
        <Card>
          <CardContent className="p-10 flex flex-col items-center gap-3 text-center">
            <Activity className="h-10 w-10 text-muted-foreground" />
            <p className="font-medium text-sm">尚無用量紀錄</p>
            <p className="text-xs text-muted-foreground max-w-sm">
              統計自本功能啟用後開始。使用知識查詢、OCR 入庫等 AI 功能後，這裡會顯示每日用量與呼叫紀錄。
              {projectId && " 目前篩選了單一專案，可改選「全部專案」看看。"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* 每日趨勢 */}
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-sm font-medium">
                每日用量趨勢（{metric === "tokens" ? "tokens" : "點數"}）
              </CardTitle>
              <Segmented
                label="趨勢指標"
                value={metric}
                onChange={setMetric}
                options={[
                  { value: "tokens", label: "Tokens" },
                  { value: "points", label: "點數" },
                ]}
              />
            </CardHeader>
            <CardContent className="space-y-2">
              <DailyUsageChart data={series} metric={metric} />
              {metric === "points" && (
                <p className="text-[11px] text-muted-foreground">本機 Ollama 用量不計點，只計入 tokens。</p>
              )}
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground w-fit select-none">
                  表格檢視
                </summary>
                <div className="mt-2 max-h-64 overflow-auto rounded-md border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className={TH}>日期</th>
                        <th className={cn(TH, "text-right")}>呼叫</th>
                        <th className={cn(TH, "text-right")}>Tokens</th>
                        <th className={cn(TH, "text-right")}>點數</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...series].reverse().map((d) => (
                        <tr key={d.date} className="border-t">
                          <td className={TD}>{d.date}</td>
                          <td className={cn(TD, NUM)}>{formatInt(d.calls)}</td>
                          <td className={cn(TD, NUM)}>{formatInt(d.total_tokens)}</td>
                          <td className={cn(TD, NUM)}>{formatPoints(d.points)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 @4xl:grid-cols-2">
            {/* 依用途 */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">依用途（tokens）</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.by_operation.length === 0 && <p className="text-xs text-muted-foreground">無資料</p>}
                {[...data.by_operation]
                  .sort((a, b) => b.total_tokens - a.total_tokens)
                  .map((o) => (
                    <div key={o.operation} className="space-y-1">
                      <div className="flex items-baseline justify-between gap-2 text-xs">
                        <span className="font-medium">{operationLabel(o.operation)}</span>
                        <span className="tabular-nums text-muted-foreground">
                          <span className="text-foreground font-medium">{formatCompact(o.total_tokens)}</span>
                          {opSum > 0 && ` · ${((o.total_tokens / opSum) * 100).toFixed(0)}%`} · {formatInt(o.calls)} 次
                        </span>
                      </div>
                      <HBar ratio={opMax > 0 ? o.total_tokens / opMax : 0} />
                    </div>
                  ))}
              </CardContent>
            </Card>

            {/* 依模型 */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">依模型</CardTitle>
              </CardHeader>
              <CardContent className="p-0 pb-2">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr>
                        <th className={TH}>模型</th>
                        <th className={TH}>用途</th>
                        <th className={cn(TH, "text-right")}>呼叫</th>
                        <th className={cn(TH, "text-right min-w-[110px]")}>Tokens</th>
                        <th className={cn(TH, "text-right")}>平均耗時</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.by_model.length === 0 && (
                        <tr>
                          <td colSpan={5} className={cn(TD, "text-muted-foreground")}>無資料</td>
                        </tr>
                      )}
                      {[...data.by_model]
                        .sort((a, b) => b.total_tokens - a.total_tokens)
                        .map((m) => (
                          <tr key={`${m.provider}|${m.model}|${m.operation}`} className="border-t">
                            <td className={TD}>
                              <span className="inline-flex items-center gap-1.5">
                                <ProviderBadge provider={m.provider} />
                                <span className="font-mono text-[11px]">{m.model}</span>
                              </span>
                            </td>
                            <td className={TD}>{operationLabel(m.operation)}</td>
                            <td className={cn(TD, NUM)}>{formatInt(m.calls)}</td>
                            <td className={cn(TD, NUM)}>
                              <div className="font-medium">{formatCompact(m.total_tokens)}</div>
                              <HBar ratio={modelMax > 0 ? m.total_tokens / modelMax : 0} />
                            </td>
                            <td className={cn(TD, NUM)}>{formatLatency(m.avg_latency_ms)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* 依專案 */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">依專案</CardTitle>
            </CardHeader>
            <CardContent className="p-0 pb-2">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <th className={TH}>專案</th>
                      <th className={cn(TH, "text-right")}>呼叫</th>
                      <th className={cn(TH, "text-right")}>Tokens</th>
                      <th className={cn(TH, "text-right")}>點數</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.by_project.length === 0 && (
                      <tr>
                        <td colSpan={4} className={cn(TD, "text-muted-foreground")}>無資料</td>
                      </tr>
                    )}
                    {[...data.by_project]
                      .sort((a, b) => b.total_tokens - a.total_tokens)
                      .map((p) => (
                        <tr key={p.project_id ?? "__none__"} className="border-t">
                          <td className={cn(TD, "max-w-[280px] truncate")} title={p.project_id ?? undefined}>
                            {p.project_name ?? p.project_id ?? (
                              <span className="text-muted-foreground">未指定專案</span>
                            )}
                          </td>
                          <td className={cn(TD, NUM)}>{formatInt(p.calls)}</td>
                          <td className={cn(TD, NUM)}>{formatInt(p.total_tokens)}</td>
                          <td className={cn(TD, NUM)}>{formatPoints(p.points)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* 最近呼叫紀錄 */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">最近呼叫紀錄</CardTitle>
            </CardHeader>
            <CardContent className="p-0 pb-2">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <th className={TH}>時間</th>
                      <th className={TH}>模型</th>
                      <th className={TH}>用途</th>
                      <th className={TH}>專案</th>
                      <th className={cn(TH, "text-right")}>Tokens</th>
                      <th className={cn(TH, "text-right")}>耗時</th>
                      <th className={TH}>狀態</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.map((r, i) => (
                      <tr key={`${r.created_at}-${i}`} className="border-t">
                        <td className={cn(TD, "tabular-nums text-muted-foreground")}>
                          {new Date(r.created_at).toLocaleString("zh-TW", { hour12: false })}
                        </td>
                        <td className={TD}>
                          <span className="inline-flex items-center gap-1.5">
                            <ProviderBadge provider={r.provider} />
                            <span className="font-mono text-[11px]">{r.model}</span>
                          </span>
                        </td>
                        <td className={TD}>{operationLabel(r.operation)}</td>
                        <td className={cn(TD, "max-w-[180px] truncate")} title={r.project_id ?? undefined}>
                          {r.project_name ?? r.project_id ?? <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className={cn(TD, NUM)}>
                          {formatInt(r.total_tokens)}
                          {r.estimated && (
                            <Badge
                              variant="outline"
                              className="ml-1 text-[9px] px-1 py-0 text-muted-foreground"
                              title="平台未回報 token 數，依字數估算"
                            >
                              估算
                            </Badge>
                          )}
                        </td>
                        <td className={cn(TD, NUM)}>{formatLatency(r.latency_ms)}</td>
                        <td className={TD}>
                          {r.success ? (
                            <span className="inline-flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3 text-green-600" />
                              成功
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-400">
                              <OctagonAlert className="h-3 w-3" />
                              失敗
                              {r.error_code && <span className="font-mono text-[10px]">({r.error_code})</span>}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </>
  )
}

function UsageSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-busy="true" aria-label="用量載入中…">
      <StatCardsSkeleton count={4} />
      <Card>
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-[200px] w-full" />
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <Card key={i}>
            <CardContent className="p-4 space-y-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
              <Skeleton className="h-3 w-3/5" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

export default function UsagePage() {
  const [days, setDays] = useState<number>(30)
  const [projectId, setProjectId] = useState("")
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [data, setData] = useState<UsageSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [metric, setMetric] = useState<DailyMetric>("tokens")
  // 目前篩選對應的請求鍵；nonce 供「重新整理／重試」強制重抓
  const [nonce, setNonce] = useState(0)
  const reqKey = `${days}|${projectId}|${nonce}`
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const loading = loadedKey !== reqKey
  const latestKey = useRef(reqKey)
  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    const key = reqKey
    latestKey.current = key
    const qs = new URLSearchParams({ days: String(days) })
    if (projectId) qs.set("project_id", projectId)
    fetchJson<unknown>(`/api/usage/summary?${qs}`).then(({ data: d, error: err }) => {
      if (latestKey.current !== key) return // 已有較新的請求
      if (err) {
        setError(err)
        setData(null) // 不顯示與目前篩選不符的舊資料
      } else {
        setError(null)
        setData(normalizeSummary(d))
      }
      setLoadedKey(key)
    })
  }, [reqKey, days, projectId])

  useEffect(() => {
    fetchJson<{ projects?: ProjectOption[] }>("/api/projects").then(({ data: d }) =>
      setProjects((d?.projects ?? []).map((p) => ({ id: p.id, name: p.name })))
    )
  }, [])

  return (
    <div className="@container p-4 sm:p-6 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Gauge className="h-6 w-6 text-primary" />
            AI 用量
          </h1>
          <p className="text-muted-foreground text-sm mt-1">AI 平台點數、tokens 與呼叫紀錄</p>
        </div>
      </div>

      {/* 篩選列：期間優先，再來專案；範圍套用到下方所有數字 */}
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="期間"
          value={days}
          onChange={setDays}
          options={USAGE_PERIODS.map((d) => ({ value: d, label: `近 ${d} 天` }))}
        />
        <div className="relative">
          <select
            aria-label="專案"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="appearance-none text-xs border rounded-md px-2.5 py-1.5 pr-7 bg-background hover:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary max-w-[240px]"
          >
            <option value="">全部專案</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
        </div>
        <Button variant="ghost" size="sm" onClick={reload} disabled={loading} className="h-7 gap-1 text-xs">
          {loading && data ? (
            <InlineSpinner label="更新中…" iconClassName="h-3.5 w-3.5" />
          ) : (
            <>
              <RefreshCw className="h-3.5 w-3.5" />
              重新整理
            </>
          )}
        </Button>
      </div>

      <BackendErrorBanner message={loading ? null : error} onRetry={reload} />

      {/* 首次載入用骨架；之後切換篩選保留舊畫面（降低透明度），避免跳動 */}
      {!data && loading ? (
        <UsageSkeleton />
      ) : data ? (
        <div className={cn("space-y-4 transition-opacity", loading && "opacity-60")} aria-busy={loading}>
          <UsageBody data={data} days={days} projectId={projectId} metric={metric} setMetric={setMetric} />
        </div>
      ) : null}

      <p className="text-[11px] text-muted-foreground flex items-start gap-1.5 leading-relaxed">
        <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
        點數換算：1 點 = 10 萬 tokens（平台推論類）；本機 Ollama 用量僅供參考不計點；官方扣點以平台通知為準；統計自本功能啟用後開始。
      </p>
    </div>
  )
}
