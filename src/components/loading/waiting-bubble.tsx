"use client"

import { useEffect, useState } from "react"
import { Sparkles } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"

/** 從掛載起算經過的秒數 */
export function useElapsedSeconds(running = true) {
  const [sec, setSec] = useState(0)
  useEffect(() => {
    if (!running) return
    const startAt = Date.now()
    setSec(0)
    const t = setInterval(() => setSec(Math.floor((Date.now() - startAt) / 1000)), 1000)
    return () => clearInterval(t)
  }, [running])
  return sec
}

/** 三個跳動點（reduced-motion 時 globals.css 會停掉 bounce，退化為靜態點） */
export function TypingDots() {
  return (
    <span className="inline-flex items-end gap-0.5" aria-hidden>
      {[0, 150, 300].map((d) => (
        <span
          key={d}
          className="h-1.5 w-1.5 rounded-full bg-current animate-bounce"
          style={{ animationDelay: `${d}ms` }}
        />
      ))}
    </span>
  )
}

/** 對話中的「AI 處理中」佔位泡泡，含經過秒數 */
export function WaitingBubble({ label = "AI 正在搜尋文件並生成回答" }: { label?: string }) {
  const sec = useElapsedSeconds()
  return (
    <div className="flex justify-start" role="status" aria-live="polite">
      <div className="max-w-[85%] space-y-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
          <Sparkles className="h-3 w-3" />
          AI 回答
        </div>
        <Card className="border-primary/30">
          <CardContent className="p-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-2 text-foreground/80">
              <TypingDots />
              {label}…
            </span>
            <span className="text-xs tabular-nums">已等待 {sec} 秒</span>
            {sec >= 20 && (
              <span className="basis-full text-[11px]">回答較長或文件較多時可能需要一些時間，請稍候</span>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
