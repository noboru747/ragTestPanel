"use client"

import { useMemo, useState } from "react"
import { ShieldCheck, ShieldQuestion } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  categoryLabel,
  splitMaskedText,
  type MaskMapping,
  type MaskSegment,
} from "@/lib/mask"

type MaskPart = Extract<MaskSegment, { kind: "mask" }>

/** 單一代號：有對照 → 琥珀淡底＋虛線底線＋盾牌；無對照 → 灰色 */
function MaskToken({ seg, showOriginal }: { seg: MaskPart; showOriginal: boolean }) {
  const [open, setOpen] = useState(false)
  const restored = seg.original !== undefined
  const display = restored && showOriginal ? seg.original : seg.placeholder
  const tip = restored
    ? `遮罩還原 · 原代號${seg.placeholder} · 類別 ${categoryLabel(seg.category)} · AI 平台僅看到代號`
    : `無對照資料 · 代號${seg.placeholder} · 類別 ${categoryLabel(seg.category)}`
  const Icon = restored ? ShieldCheck : ShieldQuestion

  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger
        // 觸控裝置沒有 hover，點一下切換 tooltip
        onClick={() => setOpen((o) => !o)}
        render={
          <span
            role="button"
            tabIndex={0}
            aria-label={tip}
            className={
              restored
                ? "inline-flex items-baseline gap-0.5 rounded-sm bg-amber-100/70 px-0.5 text-amber-900 underline decoration-amber-500 decoration-dashed underline-offset-2 cursor-help dark:bg-amber-500/15 dark:text-amber-200"
                : "inline-flex items-baseline gap-0.5 rounded-sm bg-muted px-0.5 text-muted-foreground cursor-help"
            }
          />
        }
      >
        <Icon className="h-3 w-3 shrink-0 self-center opacity-80" aria-hidden />
        {display}
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  )
}

/**
 * 顯示含遮罩代號的回答文字。
 * 文字以 React 節點渲染（不使用 dangerouslySetInnerHTML），換行與 Markdown 原樣保留（whitespace-pre-wrap）。
 */
export function MaskedText({
  content,
  mappings,
  showOriginal,
  className,
}: {
  content: string
  mappings: MaskMapping[] | undefined
  showOriginal: boolean
  className?: string
}) {
  const segments = useMemo(() => splitMaskedText(content ?? "", mappings), [content, mappings])
  return (
    <div className={className}>
      {segments.map((seg, i) =>
        seg.kind === "text" ? (
          <span key={i}>{seg.text}</span>
        ) : (
          <MaskToken key={i} seg={seg} showOriginal={showOriginal} />
        )
      )}
    </div>
  )
}
