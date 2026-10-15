"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight, FileText } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { MaskedText } from "@/components/masked-answer"
import type { MaskMapping } from "@/lib/mask"

/** /api/query 回應的 sources 項目（chunk 欄位為新增，舊回應沒有） */
export type QuerySource = {
  docId: string
  docName: string
  relevance: number
  /** 0 起算 */
  chunk_index?: number | null
  chunk_total?: number | null
  char_start?: number | null
  char_end?: number | null
  /** 段落內容（後端有回傳時才可展開） */
  snippet?: string | null
  content?: string | null
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

export function hasChunkInfo(s: QuerySource): boolean {
  return isNum(s.chunk_index)
}

/** 「第 i/N 段」；沒有 chunk 欄位時回 null */
export function chunkLabel(s: QuerySource): string | null {
  if (!isNum(s.chunk_index)) return null
  const i = s.chunk_index + 1
  return isNum(s.chunk_total) && s.chunk_total > 0 ? `第 ${i}/${s.chunk_total} 段` : `第 ${i} 段`
}

export type SourceGroup = { key: string; docName: string; items: QuerySource[]; best: number }

/** 依文件分組；組的順序依該組最高相關度，組內依段落順序 */
export function groupSources(sources: QuerySource[]): SourceGroup[] {
  const map = new Map<string, SourceGroup>()
  for (const s of sources) {
    const key = s.docId || s.docName
    const g = map.get(key)
    if (g) {
      g.items.push(s)
      g.best = Math.max(g.best, s.relevance)
    } else {
      map.set(key, { key, docName: s.docName, items: [s], best: s.relevance })
    }
  }
  const groups = [...map.values()]
  for (const g of groups) {
    g.items.sort((a, b) => (a.chunk_index ?? 0) - (b.chunk_index ?? 0))
  }
  return groups.sort((a, b) => b.best - a.best)
}

function pct(r: number) {
  return `${(r * 100).toFixed(0)}% 相關`
}

function snippetOf(s: QuerySource): string | null {
  const t = s.snippet ?? s.content
  return typeof t === "string" && t.trim() ? t : null
}

/** 一個段落列：可展開段落內容 */
function ChunkRow({
  src,
  title,
  mappings,
  showOriginal,
  indent,
}: {
  src: QuerySource
  title: string
  mappings?: MaskMapping[]
  showOriginal: boolean
  indent?: boolean
}) {
  const [open, setOpen] = useState(false)
  const snippet = snippetOf(src)
  const range =
    isNum(src.char_start) && isNum(src.char_end) ? `字元 ${src.char_start.toLocaleString()}–${src.char_end.toLocaleString()}` : null
  const head = (
    <>
      {snippet ? (
        open ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        )
      ) : (
        indent && <span className="w-3 shrink-0" />
      )}
      <span className="truncate" title={range ?? undefined}>
        {title}
      </span>
      <Badge variant="outline" className="text-[10px] ml-auto shrink-0">
        {pct(src.relevance)}
      </Badge>
    </>
  )
  return (
    <div className={indent ? "pl-4" : undefined}>
      {snippet ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center gap-1.5 text-left text-xs rounded-md px-3 py-1.5 hover:bg-background/60"
        >
          {head}
        </button>
      ) : (
        <div className="flex items-center gap-1.5 text-xs px-3 py-1.5">{head}</div>
      )}
      {open && snippet && (
        <div className="mx-3 mb-2 rounded border bg-background px-2.5 py-2 max-h-56 overflow-auto">
          <MaskedText
            className="text-[11px] leading-relaxed whitespace-pre-wrap"
            content={snippet}
            mappings={mappings}
            showOriginal={showOriginal}
          />
          {range && <p className="mt-1 text-[10px] text-muted-foreground">{range}</p>}
        </div>
      )}
    </div>
  )
}

/**
 * 查詢回答的來源列表。
 * - 有 chunk 欄位：「檔名 · 第 i/N 段」；同一文件多段時分組（檔名一列、下列各段與相關度）
 * - 舊回應（無 chunk 欄位）：維持原本一列一文件的顯示
 */
export function QuerySources({
  sources,
  mappings,
  showOriginal = true,
}: {
  sources: QuerySource[]
  mappings?: MaskMapping[]
  showOriginal?: boolean
}) {
  if (!sources.length) return null
  const chunked = sources.some(hasChunkInfo)

  if (!chunked) {
    return (
      <div className="space-y-1">
        <p className="text-[11px] text-muted-foreground flex items-center gap-1">
          <FileText className="h-3 w-3" />
          參考來源（{sources.length} 份文件）
        </p>
        {sources.map((src, i) => (
          <div
            key={`${src.docId}-${i}`}
            className="flex items-center justify-between text-xs bg-muted rounded-md px-3 py-1.5"
          >
            <span className="truncate">{src.docName}</span>
            <Badge variant="outline" className="text-[10px] ml-2 shrink-0">
              {pct(src.relevance)}
            </Badge>
          </div>
        ))}
      </div>
    )
  }

  const groups = groupSources(sources)
  return (
    <div className="space-y-1">
      <p className="text-[11px] text-muted-foreground flex items-center gap-1">
        <FileText className="h-3 w-3" />
        參考來源（{groups.length} 份文件、{sources.length} 個段落）
      </p>
      {groups.map((g) =>
        g.items.length === 1 ? (
          <div key={g.key} className="bg-muted rounded-md">
            <ChunkRow
              src={g.items[0]}
              title={[g.docName, chunkLabel(g.items[0])].filter(Boolean).join(" · ")}
              mappings={mappings}
              showOriginal={showOriginal}
            />
          </div>
        ) : (
          <div key={g.key} className="bg-muted rounded-md pb-1">
            <div className="flex items-center gap-1.5 text-xs px-3 pt-1.5 pb-0.5">
              <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="truncate font-medium">{g.docName}</span>
              <span className="text-[10px] text-muted-foreground shrink-0">{g.items.length} 段</span>
            </div>
            {g.items.map((s, i) => (
              <ChunkRow
                key={`${s.chunk_index ?? i}-${i}`}
                src={s}
                title={chunkLabel(s) ?? `段落 ${i + 1}`}
                mappings={mappings}
                showOriginal={showOriginal}
                indent
              />
            ))}
          </div>
        )
      )}
    </div>
  )
}
