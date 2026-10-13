import { NextRequest, NextResponse } from "next/server"
import { parseBackendError } from "@/lib/ocr-diagnostics"

export const runtime = 'edge'

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000"

/**
 * POST /api/documents/index — 代理後端 /api/documents/index（文字向量化入庫）
 * body: { project_id: string, filename: string, text: string }
 *
 * 後端失敗時保留其 error_code / reason / hint / detail（並維持 { error, detail } 相容欄位），
 * 4xx 沿用後端狀態碼，其餘為 502。
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
      const raw = await res.text()
      const p = parseBackendError(raw)
      return NextResponse.json(
        {
          error: "入庫失敗",
          // 結構化錯誤用後端 detail；否則維持舊格式 "HTTP xxx: body"
          detail: (p.error_code || p.reason) && p.detail ? p.detail : `HTTP ${res.status}: ${raw}`,
          error_code: p.error_code,
          reason: p.reason,
          hint: p.hint,
        },
        { status: res.status >= 400 && res.status < 500 ? res.status : 502 }
      )
    }
    return NextResponse.json(await res.json())
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: "後端連線失敗", detail }, { status: 503 })
  }
}
