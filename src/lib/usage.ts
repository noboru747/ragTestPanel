/**
 * AI 用量（/api/usage/summary）型別與純函式：格式化、補齊日期、預估可用天數。
 * 前端 /usage 頁與首頁小卡共用。
 */

export type UsageOperation = "chat" | "embed" | "vision" | (string & {})
export type UsageProvider = "openai" | "ollama" | (string & {})

export type UsageQuota = {
  points_total: number | null
  tokens_per_point: number | null
  points_used: number | null
  points_remaining: number | null
  period_start: string | null
  period_end: string | null
  provider: string | null
}

export type UsageSummary = {
  quota: UsageQuota | null
  totals: {
    calls: number
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    points: number
    failed_calls: number
    estimated_calls: number
  }
  by_day: { date: string; calls: number; total_tokens: number; points: number }[]
  by_model: {
    provider: UsageProvider
    model: string
    operation: UsageOperation
    calls: number
    total_tokens: number
    avg_latency_ms: number | null
  }[]
  by_operation: { operation: UsageOperation; calls: number; total_tokens: number }[]
  by_project: {
    project_id: string | null
    project_name: string | null
    calls: number
    total_tokens: number
    points: number
  }[]
  recent: {
    created_at: string
    provider: UsageProvider
    model: string
    operation: UsageOperation
    project_id: string | null
    project_name: string | null
    total_tokens: number
    latency_ms: number | null
    success: boolean
    error_code: string | null
    estimated: boolean
  }[]
}

export const USAGE_PERIODS = [7, 30, 90] as const

export const OPERATION_LABELS: Record<string, string> = {
  chat: "生成",
  embed: "向量",
  vision: "圖片 OCR",
}

export function operationLabel(op: string | null | undefined): string {
  if (!op) return "—"
  return OPERATION_LABELS[op] ?? op
}

export function providerLabel(p: string | null | undefined): string {
  if (p === "openai") return "平台"
  if (p === "ollama") return "本機"
  return p ?? "—"
}

/** 是否計點：平台推論類計點，本機 Ollama 不計點 */
export function providerBillable(p: string | null | undefined): boolean {
  return p === "openai"
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0)

/** 把後端回應整理成完整結構（缺欄位補預設），避免畫面因 null 崩潰 */
export function normalizeSummary(raw: unknown): UsageSummary {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const t = (o.totals && typeof o.totals === "object" ? o.totals : {}) as Record<string, unknown>
  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
  const q = o.quota && typeof o.quota === "object" ? (o.quota as UsageQuota) : null
  return {
    quota: q,
    totals: {
      calls: num(t.calls),
      prompt_tokens: num(t.prompt_tokens),
      completion_tokens: num(t.completion_tokens),
      total_tokens: num(t.total_tokens),
      points: num(t.points),
      failed_calls: num(t.failed_calls),
      estimated_calls: num(t.estimated_calls),
    },
    by_day: arr(o.by_day),
    by_model: arr(o.by_model),
    by_operation: arr(o.by_operation),
    by_project: arr(o.by_project),
    recent: arr(o.recent),
  }
}

/** 1,284 / 12.9K / 4.2M */
export function formatCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—"
  const abs = Math.abs(n)
  if (abs < 1000) return Number.isInteger(n) ? n.toLocaleString("en-US") : n.toFixed(1)
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n)
}

export function formatInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—"
  return Math.round(n).toLocaleString("en-US")
}

/** 點數：整數不帶小數，小數最多 2 位（極小值顯示 <0.01） */
export function formatPoints(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—"
  if (n === 0) return "0"
  if (Math.abs(n) < 0.01) return "<0.01"
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 })
}

export function formatLatency(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—"
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`
}

function ymd(d: Date): string {
  const p = (x: number) => String(x).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 以 today 為結尾補齊 days 天（缺的日期補 0），日期字串 YYYY-MM-DD */
export function fillDays(
  byDay: UsageSummary["by_day"],
  days: number,
  today: Date = new Date()
): UsageSummary["by_day"] {
  const map = new Map(byDay.map((d) => [String(d.date).slice(0, 10), d]))
  const out: UsageSummary["by_day"] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
    const key = ymd(d)
    const hit = map.get(key)
    out.push({
      date: key,
      calls: num(hit?.calls),
      total_tokens: num(hit?.total_tokens),
      points: num(hit?.points),
    })
  }
  return out
}

const DAY_MS = 86_400_000

/** 期間結束剩餘天數（period_end 為 null 或無法解析時回 null；已過期回 0） */
export function daysUntil(end: string | null | undefined, now: Date = new Date()): number | null {
  if (!end) return null
  const t = Date.parse(end)
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.ceil((t - now.getTime()) / DAY_MS))
}

/**
 * 以目前速度預估剩餘點數可用天數。
 * 速度 = 有紀錄的第一天到今天（含）之間的平均每日點數；沒有用量時回 null（無法預估）。
 */
export function forecastDays(
  pointsRemaining: number | null | undefined,
  byDay: UsageSummary["by_day"],
  now: Date = new Date()
): number | null {
  if (pointsRemaining == null || !Number.isFinite(pointsRemaining)) return null
  const used = byDay.filter((d) => num(d.points) > 0)
  if (!used.length) return null
  const total = used.reduce((s, d) => s + num(d.points), 0)
  const first = used.map((d) => Date.parse(String(d.date).slice(0, 10))).reduce((a, b) => Math.min(a, b))
  const today = Date.parse(ymd(now))
  const span = Math.max(1, Math.round((today - first) / DAY_MS) + 1)
  const rate = total / span
  if (rate <= 0) return null
  return Math.max(0, Math.floor(pointsRemaining / rate))
}

/** 剩餘比例 0..1（無總點數時 null） */
export function remainingRatio(q: UsageQuota | null | undefined): number | null {
  if (!q || !q.points_total || q.points_total <= 0 || q.points_remaining == null) return null
  return Math.min(1, Math.max(0, q.points_remaining / q.points_total))
}

/** 剩餘比例 → 狀態：>30% 正常、10–30% 偏低、<10% 告急 */
export function quotaLevel(ratio: number | null): "ok" | "low" | "critical" | null {
  if (ratio == null) return null
  if (ratio < 0.1) return "critical"
  if (ratio < 0.3) return "low"
  return "ok"
}

/** 圖表 Y 軸的整齊刻度（含 0），最多約 5 格 */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1]
  const raw = max / count
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag
  const top = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Number(v.toPrecision(12)))
  return ticks
}
