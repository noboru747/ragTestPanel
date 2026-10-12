import { NextRequest, NextResponse } from "next/server"

export const runtime = 'edge'

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000"

/**
 * POST /api/ocr（multipart）
 * - file：必填
 * - mask："true" | "false"，轉傳給後端做本機敏感資料遮罩（預設 false，與舊行為相同）
 * - project_id：有給時一併轉給後端 extract（mask=true 時代號在專案內統一編號並寫入本機對照表），
 *   且會順便入庫（舊行為）
 * - index："false" 時即使有 project_id 也不入庫 — OCR 頁兩階段流程用，入庫改由 /api/documents/index 負責
 */
export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const file = formData.get("file") as File | null

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 })
  }

  // 送到 Python backend 提取文字
  const backendForm = new FormData()
  backendForm.append("file", file, file.name)
  const mask = formData.get("mask") === "true"
  backendForm.append("mask", mask ? "true" : "false")
  const projectId = formData.get("project_id") as string | null
  if (projectId) backendForm.append("project_id", projectId)

  let extractedText = ""
  let method = "unknown"
  let masked = false
  let maskSummary: Record<string, number> | undefined
  let maskTotal: number | undefined
  let maskMs: number | undefined
  let maskScope: string | undefined
  let error: string | null = null

  try {
    const ocrRes = await fetch(`${BACKEND}/api/ocr/extract`, {
      method: "POST",
      body: backendForm,
    })

    if (!ocrRes.ok) {
      const errBody = await ocrRes.text()
      error = `OCR failed: ${errBody}`
    } else {
      const ocrData = await ocrRes.json()
      extractedText = ocrData.text ?? ""
      method = ocrData.method ?? "unknown"
      masked = ocrData.masked === true
      maskSummary = ocrData.mask_summary ?? undefined
      maskTotal = ocrData.mask_total ?? undefined
      maskMs = ocrData.mask_ms ?? undefined
      maskScope = ocrData.mask_scope ?? undefined
    }
  } catch (e) {
    error = `Backend unreachable: ${e}`
  }

  if (error) {
    return NextResponse.json({ success: false, error }, { status: 502 })
  }

  // 如果有 project_id，順便入庫向量索引
  const shouldIndex = formData.get("index") !== "false"
  if (shouldIndex && projectId && extractedText) {
    try {
      await fetch(`${BACKEND}/api/documents/index`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          filename: file.name,
          text: extractedText,
        }),
      })
    } catch {
      // 入庫失敗不影響 OCR 結果回傳
    }
  }

  return NextResponse.json({
    success: true,
    filename: file.name,
    text: extractedText,
    method,
    char_count: extractedText.length,
    masked,
    mask_summary: maskSummary,
    mask_total: maskTotal,
    mask_ms: maskMs,
    mask_scope: maskScope,
  })
}
