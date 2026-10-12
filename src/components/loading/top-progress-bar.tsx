"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"

/**
 * 頂部細進度條（自製，不引入套件）。
 * - 開始：攔截站內 <a> 點擊（含 next/link），目標 URL 與目前不同時啟動
 * - 進行：寬度以遞減速度緩慢逼近 90%
 * - 結束：pathname / search 變化時補到 100% 後淡出；10 秒保險逾時自動結束
 * 需放在 <Suspense> 內（使用 useSearchParams）。
 */
export function TopProgressBar() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [progress, setProgress] = useState(0)
  const [visible, setVisible] = useState(false)
  const trickle = useRef<ReturnType<typeof setInterval> | null>(null)
  const safety = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hide = useRef<ReturnType<typeof setTimeout> | null>(null)
  const active = useRef(false)

  const clearTimers = () => {
    if (trickle.current) clearInterval(trickle.current)
    if (safety.current) clearTimeout(safety.current)
    if (hide.current) clearTimeout(hide.current)
    trickle.current = safety.current = hide.current = null
  }

  const finish = () => {
    if (!active.current) return
    active.current = false
    clearTimers()
    setProgress(100)
    hide.current = setTimeout(() => {
      setVisible(false)
      setProgress(0)
    }, 250)
  }

  const start = () => {
    clearTimers()
    active.current = true
    setVisible(true)
    setProgress(8)
    trickle.current = setInterval(() => {
      setProgress((p) => (p >= 90 ? p : p + (90 - p) * 0.08))
    }, 200)
    safety.current = setTimeout(finish, 10_000)
  }

  // 路由變化 → 結束
  useEffect(() => {
    finish()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams])

  // 攔截站內連結點擊 → 開始
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element | null)?.closest?.("a")
      if (!a || !a.href || a.hasAttribute("download")) return
      if (a.target && a.target !== "_self") return
      let url: URL
      try {
        url = new URL(a.href, window.location.href)
      } catch {
        return
      }
      if (url.origin !== window.location.origin) return
      if (url.pathname === window.location.pathname && url.search === window.location.search) return
      start()
    }
    document.addEventListener("click", onClick, true)
    return () => {
      document.removeEventListener("click", onClick, true)
      clearTimers()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5"
      style={{ opacity: visible ? 1 : 0, transition: "opacity 250ms ease" }}
    >
      <div
        className="top-progress-bar h-full bg-primary shadow-[0_0_6px_var(--color-primary)]"
        style={{ width: `${progress}%`, transition: "width 200ms ease-out" }}
      />
    </div>
  )
}
