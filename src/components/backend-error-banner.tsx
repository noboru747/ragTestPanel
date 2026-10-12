"use client"

import { AlertTriangle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type Props = {
  message: string | null | undefined
  onRetry?: () => void
  className?: string
}

/** 後端失聯 / API 錯誤時顯示的提示列。message 為空時不渲染。 */
export function BackendErrorBanner({ message, onRetry, className }: Props) {
  if (!message) return null
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive",
        className
      )}
    >
      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
      <span className="flex-1 break-all">{message}</span>
      {onRetry && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onRetry}
          className="h-6 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          <RefreshCw className="h-3.5 w-3.5 mr-1" />
          重試
        </Button>
      )}
    </div>
  )
}
