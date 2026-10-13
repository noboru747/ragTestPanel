/**
 * OCR 入庫頁的錯誤診斷 / 修復判斷（純函式，前端與 API Route 共用）。
 *
 * 後端契約：
 * - /api/ocr/extract 回應 diagnostics；repair=true 時回 repaired / repairs_applied
 * - 失敗時 body { error_code, reason, hint, detail }（FastAPI HTTPException 可能包成 { detail: {...} }）
 */

export type Suspected = "text_layer_broken" | "scanned_pdf"

export type ExtractDiagnostics = {
  nul_chars?: number
  radical_chars?: number
  text_chars?: number
  pages?: number
  chars_per_page?: number
  suspected?: Suspected | null
}

/** 統一的錯誤資訊（前端顯示用） */
export type ErrorInfo = {
  /** 一行摘要（舊有相容欄位 error） */
  message: string
  code?: string
  reason?: string
  hint?: string
  detail?: string
  status?: number
}

/** 字數少於此值視為可疑（可能是掃描檔） */
export const LOW_CHAR_THRESHOLD = 50

export const ERROR_CODE_INFO: Record<string, { title: string; explain: string; repairable: boolean }> = {
  nul_in_text: {
    title: "PDF 文字層異常：抽出的文字含空字元（字型缺少文字對應）",
    explain: "PDF 內嵌字型沒有正確的 Unicode 對應，抽出的文字夾雜空字元或亂碼，資料庫拒絕寫入。修復時會移除空字元、做 Unicode 正規化，必要時改用 OCR 重新辨識。",
    repairable: true,
  },
  empty_text: {
    title: "沒有抽出任何文字（可能是掃描檔）",
    explain: "檔案沒有可擷取的文字層，常見於掃描成 PDF 的紙本文件。修復時會改用 OCR 逐頁辨識。",
    repairable: true,
  },
  embedding_failed: {
    title: "AI 平台向量計算失敗",
    explain: "文字已抽出，但呼叫 AI 平台計算向量時失敗（可能是平台忙碌、額度或網路問題）。請稍後再試。",
    repairable: false,
  },
  db_error: {
    title: "資料庫寫入失敗",
    explain: "向量已算好，但寫入資料庫時發生錯誤。請確認資料庫服務正常後再試。",
    repairable: false,
  },
  unsupported_type: {
    title: "不支援的檔案格式",
    explain: "後端無法解析此檔案格式，請轉成 PDF、Word 或圖片後再上傳。",
    repairable: false,
  },
}

const REPAIR_LABELS: Record<string, string> = {
  strip_nul: "移除空字元",
  nfkc: "Unicode 正規化",
  pdf_ocr: "改用 OCR",
}

export function repairLabel(code: string): string {
  return REPAIR_LABELS[code] ?? code
}

export function formatRepairs(codes: string[] | undefined): string {
  if (!codes || codes.length === 0) return "無需修改（內容與原本相同）"
  return codes.map(repairLabel).join("、")
}

function str(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v
  if (v != null && typeof v === "object") {
    try {
      return JSON.stringify(v)
    } catch {
      return undefined
    }
  }
  return undefined
}

/**
 * 從後端錯誤 body 抽出 error_code / reason / hint / detail。
 * 支援：
 *   { error_code, reason, hint, detail }
 *   { detail: { error_code, reason, hint, detail } }  （FastAPI HTTPException）
 *   { detail: "..." } / 純文字
 */
export function parseBackendError(
  raw: unknown
): { error_code?: string; reason?: string; hint?: string; detail?: string } {
  if (raw == null) return {}
  if (typeof raw === "string") {
    const s = raw.trim()
    if (!s) return {}
    try {
      return parseBackendError(JSON.parse(s))
    } catch {
      return { detail: s }
    }
  }
  if (typeof raw !== "object") return { detail: String(raw) }
  const o = raw as Record<string, unknown>
  // FastAPI HTTPException(detail={...}) 會包一層
  if (o.detail && typeof o.detail === "object" && !Array.isArray(o.detail) && !o.error_code) {
    const inner = parseBackendError(o.detail)
    if (inner.error_code || inner.reason) return inner
  }
  return {
    error_code: typeof o.error_code === "string" ? o.error_code : undefined,
    reason: str(o.reason),
    hint: str(o.hint),
    detail: str(o.detail),
  }
}

/** 由 API Route 回應 body（{ error, detail, error_code, reason, hint }）組成 ErrorInfo */
export function toErrorInfo(body: unknown, fallback: string, status?: number): ErrorInfo {
  const o = (body && typeof body === "object" ? body : {}) as Record<string, unknown>
  const p = parseBackendError(body)
  const known = p.error_code ? ERROR_CODE_INFO[p.error_code] : undefined
  const error = typeof o.error === "string" && o.error ? o.error : undefined
  const message = known?.title ?? p.reason ?? error ?? fallback
  return {
    message,
    code: p.error_code,
    reason: p.reason ?? (error && error !== message ? error : undefined),
    hint: p.hint,
    detail: p.detail ?? (status != null && !p.reason && !error ? `HTTP ${status}` : undefined),
    status,
  }
}

export function isRepairableCode(code: string | undefined): boolean {
  return !!code && ERROR_CODE_INFO[code]?.repairable === true
}

/** 抽出結果是否可疑（可能是掃描檔 / 文字層壞掉），回傳警示文字或 null */
export function suspicionOf(
  diagnostics: ExtractDiagnostics | undefined,
  extractedChars: number | null | undefined
): string | null {
  const n = extractedChars ?? 0
  if (diagnostics?.suspected === "text_layer_broken") {
    return `PDF 文字層可能異常（字型缺少文字對應），抽出 ${n.toLocaleString()} 字`
  }
  if (diagnostics?.suspected === "scanned_pdf") {
    return `可能是掃描檔，只抽出 ${n.toLocaleString()} 字`
  }
  if (extractedChars != null && extractedChars < LOW_CHAR_THRESHOLD) {
    return `可能是掃描檔，只抽出 ${n.toLocaleString()} 字`
  }
  return null
}
