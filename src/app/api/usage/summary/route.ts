import { NextRequest, NextResponse } from "next/server"

export const runtime = 'edge'

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000"

/**
 * GET /api/usage/summary?days=30&project_id= — 代理後端 AI 用量統計
 * - days：7 / 30 / 90（其他值一律以 30 送出）
 * - project_id：選填，空字串不送
 * 錯誤：後端回非 2xx → 502 { error, detail }；後端無法連線 → 503 { error, detail }
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const daysRaw = Number(sp.get("days"))
  const days = [7, 30, 90].includes(daysRaw) ? daysRaw : 30
  const projectId = sp.get("project_id")?.trim()

  const qs = new URLSearchParams({ days: String(days) })
  if (projectId) qs.set("project_id", projectId)

  try {
    const res = await fetch(`${BACKEND}/api/usage/summary?${qs}`, {
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      return NextResponse.json(
        { error: "用量查詢失敗", detail: `HTTP ${res.status}: ${await res.text()}` },
        { status: 502 }
      )
    }
    return NextResponse.json(await res.json())
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: "後端連線失敗", detail }, { status: 503 })
  }
}
