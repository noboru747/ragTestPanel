/**
 * 跨頁一次性訊息（專案沒有 toast 機制）：寫入 sessionStorage，下一頁讀取後即刪除。
 * 所有存取都包 try/catch，storage 不可用時靜默略過。
 */
const KEY = "app.flashMessage"

export function setFlashMessage(msg: string) {
  try {
    window.sessionStorage.setItem(KEY, msg)
  } catch {
    /* ignore */
  }
}

export function takeFlashMessage(): string | null {
  try {
    const msg = window.sessionStorage.getItem(KEY)
    if (msg) window.sessionStorage.removeItem(KEY)
    return msg
  } catch {
    return null
  }
}
