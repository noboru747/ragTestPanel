import { NextRequest, NextResponse } from "next/server"
import { parseBackendError } from "@/lib/ocr-diagnostics"

export const runtime = 'edge'

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000"

/**
 * POST /api/ocr（multipart）
 * - file：必填
 * - mask："true" | "false"，轉傳給後端做本機敏感資料遮罩（預設 false，與舊行為相同）
 * - project_id：有給時一併轉給後端 extract（mask=true 時代號在專案內統一編號並寫入本機對照表），
 *   且會順便入庫（舊行為）
 * - index："false" 時即使有 project_id 也不入庫 — OCR 頁兩階段流程用，入庫改由 /api/documents/index 負責
 * - repair："true" 時請後端套用修復（移除空字元、Unicode 正規化、必要時改用 OCR）
 *
 * 成功回應另透傳 diagnostics / repaired / repairs_applied。
 * 後端失敗時保留其 error_code / reason / hint / detail，並維持 { success:false, error, detail } 相容欄位；
 * 4xx（如 415 不支援格式）沿用後端狀態碼，其餘為 502。
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
  const repair = formData.get("repair") === "true"
  backendForm.append("repair", repair ? "true" : "false")

  let extractedText = ""
  let method = "unknown"
  let masked = false
  let maskSummary: Record<string, number> | undefined
  let maskTotal: number | undefined
  let maskMs: number | undefined
  let maskScope: string | undefined
  let diagnostics: unknown
  let repaired: boolean | undefined
  let repairsApplied: string[] | undefined
  let error: string | null = null
  let errorStatus = 502
  let errorFields: ReturnType<typeof parseBackendError> = {}

  try {
    const ocrRes = await fetch(`${BACKEND}/api/ocr/extract`, {
      method: "POST",
      body: backendForm,
    })

    if (!ocrRes.ok) {
      const errBody = await ocrRes.text()
      errorFields = parseBackendError(errBody)
      error = `OCR failed: ${errorFields.reason ?? errBody}`
      if (!(errorFields.error_code || errorFields.reason) || !errorFields.detail)
        errorFields.detail = `HTTP ${ocrRes.status}: ${errBody}`
      if (ocrRes.status >= 400 && ocrRes.status < 500) errorStatus = ocrRes.status
    } else {
      const ocrData = await ocrRes.json()
      extractedText = ocrData.text ?? ""
      method = ocrData.method ?? "unknown"
      masked = ocrData.masked === true
      maskSummary = ocrData.mask_summary ?? undefined
      maskTotal = ocrData.mask_total ?? undefined
      maskMs = ocrData.mask_ms ?? undefined
      maskScope = ocrData.mask_scope ?? undefined
      diagnostics = ocrData.diagnostics ?? undefined
      repaired = typeof ocrData.repaired === "boolean" ? ocrData.repaired : undefined
      repairsApplied = Array.isArray(ocrData.repairs_applied) ? ocrData.repairs_applied : undefined
    }
  } catch (e) {
    error = `Backend unreachable: ${e}`
    errorStatus = 503
    errorFields = { detail: String(e) }
  }

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error,
        detail: errorFields.detail,
        error_code: errorFields.error_code,
        reason: errorFields.reason,
        hint: errorFields.hint,
      },
      { status: errorStatus }
    )
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
    diagnostics,
    repaired,
    repairs_applied: repairsApplied,
  })
}
