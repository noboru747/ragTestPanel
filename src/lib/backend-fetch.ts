/**
 * 前端呼叫 Next.js API Route 的共用 helper。
 * API Route 在後端失聯時會回傳 503 + { error, detail }，這裡統一轉成可顯示的錯誤訊息。
 */

export const BACKEND_UNAVAILABLE_MSG = "無法連線到後端服務"

export type FetchResult<T> = { data: T | null; error: string | null }

export async function fetchJson<T = unknown>(
  input: string,
  init?: RequestInit
): Promise<FetchResult<T>> {
  try {
    const res = await fetch(input, init)
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      body = null
    }
    if (!res.ok) {
      const b = (body ?? {}) as { error?: string; detail?: string }
      const msg =
        res.status === 503 || res.status === 502
          ? BACKEND_UNAVAILABLE_MSG
          : b.error ?? `請求失敗（HTTP ${res.status}）`
      return { data: null, error: b.detail ? `${msg}：${b.detail}` : msg }
    }
    return { data: body as T, error: null }
  } catch (err) {
    return {
      data: null,
      error: `${BACKEND_UNAVAILABLE_MSG}：${err instanceof Error ? err.message : String(err)}`,
    }
  }
}
