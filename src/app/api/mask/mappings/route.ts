import { NextRequest, NextResponse } from "next/server"

export const runtime = 'edge'

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000"

/**
 * GET /api/mask/mappings?project_id=X — 代理後端遮罩對照表（僅存在本機資料庫）
 * 回應：{ mappings: { placeholder, category, original, filenames, updated_at }[] }
 */
export async function GET(req: NextRequest) {
  const projectId = new URL(req.url).searchParams.get("project_id")
  if (!projectId) {
    return NextResponse.json({ error: "缺少 project_id", mappings: [] }, { status: 400 })
  }
  try {
    const res = await fetch(
      `${BACKEND}/api/mask/mappings?project_id=${encodeURIComponent(projectId)}`,
      { signal: AbortSignal.timeout(10_000) }
    )
    if (!res.ok) {
      return NextResponse.json(
        { error: "後端回應錯誤", detail: `HTTP ${res.status}: ${await res.text()}`, mappings: [] },
        { status: 502 }
      )
    }
    return NextResponse.json(await res.json())
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: "後端連線失敗", detail, mappings: [] }, { status: 503 })
  }
}
