/**
 * 敏感資料遮罩相關的共用型別與純函式（不含 React，可直接用 tsx 測試）。
 *
 * 代號格式：【標籤_N】，例如【IP_1】、【電話_2】
 */

/** category key → 中文名稱 */
export const MASK_LABELS: Record<string, string> = {
  ip: "IP 位址",
  mac: "MAC 位址",
  email: "Email",
  phone: "電話",
  national_id: "身分證字號",
  credential: "密碼/金鑰",
  account: "帳號",
  api_key: "API 金鑰/憑證",
  url_internal: "內部網址",
  person: "人名",
}

/** 代號內的標籤 → category key（無對照資料時用來推測類別） */
export const PLACEHOLDER_TAG_TO_CATEGORY: Record<string, string> = {
  IP: "ip",
  MAC: "mac",
  EMAIL: "email",
  電話: "phone",
  身分證: "national_id",
  密碼: "credential",
  帳號: "account",
  金鑰: "api_key",
  內部網址: "url_internal",
  人名: "person",
}

export function categoryLabel(category: string | undefined): string {
  if (!category) return "未知類別"
  return MASK_LABELS[category] ?? category
}

/** /api/query 回應中的對照 */
export type MaskMapping = {
  placeholder: string
  category: string
  original: string
}

/** /api/mask/mappings 回應中的對照（多了出現檔案與更新時間） */
export type MaskMappingRow = MaskMapping & {
  filenames: string[]
  updated_at: string
}

export type MaskSegment =
  | { kind: "text"; text: string }
  | {
      kind: "mask"
      placeholder: string
      /** 代號內的標籤，例如 "IP" */
      tag: string
      category: string | undefined
      /** 有對照時為原值；無對照時 undefined */
      original: string | undefined
    }

// 【標籤_N】；標籤不含括號與換行，長度上限避免誤吃整段文字
const PLACEHOLDER_RE = /【([^【】\r\n_]{1,12})_(\d{1,6})】/g

/**
 * 把含代號的文字切成片段：一般文字 / 代號（附原值，若有對照）。
 * 回傳純資料，渲染端各自決定樣式 — 不產生 HTML，因此不需跳脫。
 * 相鄰的 text 片段會合併。
 */
export function splitMaskedText(text: string, mappings: MaskMapping[] | undefined): MaskSegment[] {
  const byPlaceholder = new Map<string, MaskMapping>()
  for (const m of mappings ?? []) {
    if (m && typeof m.placeholder === "string") byPlaceholder.set(m.placeholder, m)
  }

  const out: MaskSegment[] = []
  const pushText = (t: string) => {
    if (!t) return
    const last = out[out.length - 1]
    if (last && last.kind === "text") last.text += t
    else out.push({ kind: "text", text: t })
  }

  let lastIndex = 0
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    const idx = m.index ?? 0
    pushText(text.slice(lastIndex, idx))
    const placeholder = m[0]
    const tag = m[1]
    const mapping = byPlaceholder.get(placeholder)
    out.push({
      kind: "mask",
      placeholder,
      tag,
      category: mapping?.category ?? PLACEHOLDER_TAG_TO_CATEGORY[tag],
      original: mapping?.original,
    })
    lastIndex = idx + placeholder.length
  }
  pushText(text.slice(lastIndex))
  return out
}

/** 統計片段中有對照（可還原）的代號數，distinct=true 時重複代號只算一次 */
export function countRestored(segments: MaskSegment[], distinct = true): number {
  const restored = segments.filter(
    (s): s is Extract<MaskSegment, { kind: "mask" }> => s.kind === "mask" && s.original !== undefined
  )
  return distinct ? new Set(restored.map((s) => s.placeholder)).size : restored.length
}

/** 把片段組回字串：showOriginal=true 時有對照的代號換成原值 */
export function joinSegments(segments: MaskSegment[], showOriginal: boolean): string {
  return segments
    .map((s) =>
      s.kind === "text" ? s.text : showOriginal && s.original !== undefined ? s.original : s.placeholder
    )
    .join("")
}

/** OCR 遮罩摘要：「已遮罩 7 項：IP 位址 3、帳號 4」/「未發現敏感資料」 */
export function formatMaskSummary(
  total: number | undefined,
  summary: Record<string, number> | undefined
): string {
  const entries = Object.entries(summary ?? {}).filter(([, n]) => n > 0)
  const sum = total ?? entries.reduce((a, [, n]) => a + n, 0)
  if (!sum) return "未發現敏感資料"
  const detail = entries.map(([k, n]) => `${categoryLabel(k)} ${n}`).join("、")
  return detail ? `已遮罩 ${sum} 項：${detail}` : `已遮罩 ${sum} 項`
}
