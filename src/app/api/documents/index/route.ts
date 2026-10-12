import { NextRequest, NextResponse } from "next/server"

export const runtime = 'edge'

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000"

/**
 * POST /api/documents/index — 代理後端 /api/documents/index（文字向量化入庫）
 * body: { project_id: string, filename: string, text: string }
 */
export async function POST(req: NextRequest) {
  let body: { project_id?: string; filename?: string; text?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 })
  }
  if (!body.project_id || !body.filename) {
    return NextResponse.json({ error: "缺少 project_id 或 filename" }, { status: 400 })
  }

  try {
    const res = await fetch(`${BACKEND}/api/documents/index`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: body.project_id,
        filename: body.filename,
        text: body.text ?? "",
      }),
    })
    if (!res.ok) {
      return NextResponse.json(
        { error: "入庫失敗", detail: `HTTP ${res.status}: ${await res.text()}` },
        { status: 502 }
      )
    }
    return NextResponse.json(await res.json())
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: "後端連線失敗", detail }, { status: 503 })
  }
}
