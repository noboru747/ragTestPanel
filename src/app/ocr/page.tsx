"use client"

export const runtime = 'edge'

import { useState, useCallback, useEffect, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Upload,
  FileText,
  CheckCircle2,
  Loader2,
  AlertCircle,
  X,
  FolderOpen,
  Eye,
  ChevronDown,
  FolderKanban,
  Check,
  ShieldCheck,
  Circle,
  MinusCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { BackendErrorBanner } from "@/components/backend-error-banner"
import { fetchJson } from "@/lib/backend-fetch"
import { formatMaskSummary } from "@/lib/mask"
import { InlineSpinner } from "@/components/loading"
type OcrStatus = "queued" | "processing" | "completed" | "error"

type OcrItem = {
  id: string
  filename: string
  status: OcrStatus
  progress: number
  model: string
  extractedChars: number | null
  extractedText?: string
  error?: string
  file: File
  /** 階段①：掃描遮罩（未勾遮罩時為文字提取） */
  extractStep: StepState
  /** 階段②：入庫 */
  indexStep: StepState
  /** 處理時是否啟用遮罩（以開始處理當下為準） */
  maskRequested?: boolean
  masked?: boolean
  maskSummary?: Record<string, number>
  maskTotal?: number
  /** project：代號已寫入專案對照表；document：僅本文件內編號 */
  maskScope?: "project" | "document"
  method?: string
  extractError?: string
  indexError?: string
  /** 階段②略過的原因 */
  indexSkipReason?: string
}

/** 單一階段狀態：待處理 / 進行中 / 完成 / 失敗 / 略過 */
type StepState = "pending" | "running" | "done" | "error" | "skipped"

const MASK_STORAGE_KEY = "ocr.maskEnabled"

async function readError(res: Response, fallback: string) {
  try {
    const d = await res.json()
    const msg = d.error ?? fallback
    return d.detail ? `${msg}：${d.detail}` : msg
  } catch {
    return `${fallback}（HTTP ${res.status}）`
  }
}

const stepConfig = {
  pending: { icon: Circle, cls: "text-muted-foreground border-muted-foreground/30", spin: false },
  running: { icon: Loader2, cls: "text-blue-600 border-blue-300", spin: true },
  done: { icon: Check, cls: "text-green-600 border-green-300 bg-green-50 dark:bg-green-950/30", spin: false },
  error: { icon: X, cls: "text-red-600 border-red-300 bg-red-50 dark:bg-red-950/30", spin: false },
  skipped: { icon: MinusCircle, cls: "text-muted-foreground border-muted-foreground/30", spin: false },
} as const

function StepChip({ state, label }: { state: StepState; label: string }) {
  const cfg = stepConfig[state]
  const Icon = cfg.icon
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${cfg.cls}`}
    >
      <Icon className={`h-3 w-3 ${cfg.spin ? "animate-spin" : ""}`} />
      {label}
    </span>
  )
}

const statusConfig = {
  completed: { icon: CheckCircle2, color: "text-green-500", label: "完成" },
  processing: { icon: Loader2, color: "text-blue-500", label: "處理中" },
  queued: { icon: AlertCircle, color: "text-muted-foreground", label: "排隊中" },
  error: { icon: AlertCircle, color: "text-red-500", label: "錯誤" },
} as const

type ProjectOption = { id: string; name: string }

function OcrPageInner() {
  const searchParams = useSearchParams()
  const [queue, setQueue] = useState<OcrItem[]>([])
  const [dragging, setDragging] = useState(false)
  const [previewItem, setPreviewItem] = useState<OcrItem | null>(null)
  const [processing, setProcessing] = useState(false)
  const [selectedProjectId, setSelectedProjectId] = useState<string>("")
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [projectsError, setProjectsError] = useState<string | null>(null)
  const [projectsLoading, setProjectsLoading] = useState(true)
  const [maskEnabled, setMaskEnabled] = useState(true)

  // 遮罩勾選狀態記在 localStorage（讀不到就維持預設勾選）
  useEffect(() => {
    try {
      if (window.localStorage.getItem(MASK_STORAGE_KEY) === "false") setMaskEnabled(false)
    } catch {
      /* ignore */
    }
  }, [])

  const toggleMask = (v: boolean) => {
    setMaskEnabled(v)
    try {
      window.localStorage.setItem(MASK_STORAGE_KEY, v ? "true" : "false")
    } catch {
      /* ignore */
    }
  }

  // 從 URL query param 預選專案（從專案詳情頁導過來時）
  useEffect(() => {
    const pid = searchParams.get("projectId")
    if (pid) setSelectedProjectId(pid)
  }, [searchParams])

  // 從後端載入真實專案清單
  const loadProjects = useCallback(async () => {
    setProjectsError(null)
    setProjectsLoading(true)
    const { data, error } = await fetchJson<{ projects?: ProjectOption[] }>("/api/projects")
    setProjectsLoading(false)
    if (error) {
      setProjects([])
      setProjectsError(error)
      return
    }
    setProjects((data?.projects ?? []).map((p) => ({ id: p.id, name: p.name })))
  }, [])

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  const acceptedExts = new Set([
    "pdf","doc","docx","xls","xlsx","ppt","pptx","jpg","jpeg","png","gif","webp",
  ])

  const isAccepted = (name: string) => {
    const ext = name.split(".").pop()?.toLowerCase() ?? ""
    return acceptedExts.has(ext)
  }

  const readDirEntry = (entry: FileSystemDirectoryEntry): Promise<File[]> =>
    new Promise((resolve) => {
      const results: File[] = []
      const reader = entry.createReader()
      const read = () => {
        reader.readEntries(async (entries) => {
          if (!entries.length) { resolve(results); return }
          for (const e of entries) {
            if (e.isFile) {
              const f = await new Promise<File>((res) => (e as FileSystemFileEntry).file(res))
              if (isAccepted(f.name)) results.push(f)
            } else if (e.isDirectory) {
              const sub = await readDirEntry(e as FileSystemDirectoryEntry)
              results.push(...sub)
            }
          }
          read()
        })
      }
      read()
    })

  const addFiles = (files: File[]) => {
    const newItems: OcrItem[] = files.map((f) => ({
      id: `ocr-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      filename: f.name,
      status: "queued",
      progress: 0,
      model: "qwen2.5vl:7b",
      extractedChars: null,
      file: f,
      extractStep: "pending",
      indexStep: "pending",
    }))
    setQueue((prev) => [...newItems, ...prev])
  }

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const items = Array.from(e.dataTransfer.items)
    const files: File[] = []
    for (const item of items) {
      const entry = item.webkitGetAsEntry?.()
      if (entry?.isDirectory) {
        const sub = await readDirEntry(entry as FileSystemDirectoryEntry)
        files.push(...sub)
      } else {
        const f = item.getAsFile()
        if (f && isAccepted(f.name)) files.push(f)
      }
    }
    addFiles(files)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(Array.from(e.target.files).filter((f) => isAccepted(f.name)))
    e.target.value = ""
  }

  const remove = (id: string) =>
    setQueue((prev) => prev.filter((i) => i.id !== id))

  const patch = (id: string, update: Partial<OcrItem>) =>
    setQueue((prev) => prev.map((i) => (i.id === id ? { ...i, ...update } : i)))

  // 兩階段：① POST /api/ocr（提取＋遮罩，不入庫） → ② POST /api/documents/index（用遮罩後文字入庫）
  const processQueue = async () => {
    const pending = queue.filter((i) => i.status === "queued")
    if (!pending.length || processing) return
    setProcessing(true)
    // 以按下「開始處理」當下的設定為準，處理途中切換不影響本批次
    const mask = maskEnabled
    const projectId = selectedProjectId

    for (const item of pending) {
      patch(item.id, {
        status: "processing",
        progress: 20,
        extractStep: "running",
        indexStep: "pending",
        maskRequested: mask,
        error: undefined,
        extractError: undefined,
        indexError: undefined,
        indexSkipReason: undefined,
      })

      // ── 階段①：掃描遮罩 / 文字提取 ──
      let text = ""
      try {
        const form = new FormData()
        form.append("file", item.file, item.filename)
        form.append("mask", mask ? "true" : "false")
        form.append("index", "false")
        // 有選專案時一併轉給後端，讓遮罩代號在專案內統一編號並寫入本機對照表
        if (projectId) form.append("project_id", projectId)

        const res = await fetch("/api/ocr", { method: "POST", body: form })
        const data = res.ok ? await res.json() : null
        if (!res.ok || !data?.success) {
          const msg = data ? data.error ?? "文字提取失敗" : await readError(res, "文字提取失敗")
          patch(item.id, { status: "error", progress: 0, extractStep: "error", extractError: msg, error: msg })
          continue
        }
        text = data.text ?? ""
        patch(item.id, {
          progress: 60,
          extractStep: "done",
          extractedChars: data.char_count ?? text.length,
          extractedText: text,
          masked: data.masked === true,
          maskSummary: data.mask_summary,
          maskTotal: data.mask_total,
          maskScope: data.mask_scope === "project" || data.mask_scope === "document" ? data.mask_scope : undefined,
          method: data.method,
        })
      } catch {
        const msg = "無法連線到伺服器"
        patch(item.id, { status: "error", progress: 0, extractStep: "error", extractError: msg, error: msg })
        continue
      }

      // ── 階段②：入庫 ──
      if (!projectId) {
        patch(item.id, { status: "completed", progress: 100, indexStep: "skipped", indexSkipReason: "未指定專案" })
        continue
      }
      if (!text.trim()) {
        patch(item.id, { status: "completed", progress: 100, indexStep: "skipped", indexSkipReason: "無可入庫文字" })
        continue
      }
      patch(item.id, { progress: 75, indexStep: "running" })
      try {
        const res = await fetch("/api/documents/index", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project_id: projectId, filename: item.filename, text }),
        })
        if (!res.ok) {
          const msg = await readError(res, "入庫失敗")
          patch(item.id, { status: "error", progress: 0, indexStep: "error", indexError: msg, error: msg })
        } else {
          patch(item.id, { status: "completed", progress: 100, indexStep: "done" })
        }
      } catch {
        const msg = "入庫時無法連線到伺服器"
        patch(item.id, { status: "error", progress: 0, indexStep: "error", indexError: msg, error: msg })
      }
    }

    setProcessing(false)
  }

  const acceptedTypes = ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.gif,.webp"
  const pendingCount = queue.filter((i) => i.status === "queued").length
  const completedCount = queue.filter((i) => i.status === "completed").length

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold">OCR 文件入庫</h1>
          <p className="text-muted-foreground text-sm mt-1">
            批量上傳文件，透過 Ollama Vision 模型提取文字並建立向量索引
          </p>
        </div>
        <Badge variant="outline" className="flex items-center gap-1 ml-auto">
          <div className="h-2 w-2 rounded-full bg-green-500" />
          本地模式
        </Badge>
      </div>

      {/* 系統資訊 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-center">
        {[
          { label: "OCR 模型", value: "qwen2.5vl:7b" },
          { label: "Embedding", value: "nomic-embed-text" },
          { label: "資料庫", value: "PostgreSQL" },
          { label: "後端", value: "localhost:8000" },
        ].map(({ label, value }) => (
          <Card key={label}>
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-sm font-medium mt-0.5">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <BackendErrorBanner message={projectsError} onRetry={loadProjects} />

      {/* 上傳區 */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <FolderOpen className="h-4 w-4" />
              上傳至專案資料夾
            </CardTitle>
            {/* 專案選擇器 */}
            <div className="flex items-center gap-2">
              <FolderKanban className="h-3.5 w-3.5 text-muted-foreground" />
              <div className="relative">
                <select
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                  disabled={projectsLoading || processing}
                  aria-busy={projectsLoading}
                  className="appearance-none text-xs border rounded-md px-2.5 py-1 pr-6 bg-background hover:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer disabled:cursor-wait disabled:opacity-70"
                >
                  {projectsLoading ? (
                    // 載入中：只放一個佔位選項（value 對齊目前選取，避免網址預選被顯示成「不指定」）
                    <option value={selectedProjectId}>載入專案中…</option>
                  ) : (
                    <>
                      <option value="">不指定專案（不入庫）</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </>
                  )}
                </select>
                {projectsLoading ? (
                  <InlineSpinner className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" iconClassName="h-3 w-3" />
                ) : (
                  <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                )}
              </div>
              {selectedProjectId && (
                <Badge variant="secondary" className="text-[10px]">
                  文字提取後自動入庫
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 敏感資料遮罩 */}
          <div className="rounded-md border bg-muted/30 px-3 py-2.5">
            <label className="flex items-center gap-2 text-sm font-medium cursor-pointer w-fit">
              <input
                type="checkbox"
                checked={maskEnabled}
                onChange={(e) => toggleMask(e.target.checked)}
                disabled={processing}
                className="h-4 w-4 accent-primary cursor-pointer"
              />
              <ShieldCheck className={`h-4 w-4 ${maskEnabled ? "text-green-600" : "text-muted-foreground"}`} />
              敏感資料掃描遮罩（送出前於本機遮蔽 IP、帳號、密碼等）
            </label>
            <p className="text-[11px] text-muted-foreground mt-1 pl-6 leading-relaxed">
              遮罩在本機以規則處理，不經 AI；勾選時圖片改用本機 OCR，原圖不會送出。此功能非弱點掃描工具，用於避免弱掃報告、帳號清單等敏感內容外傳。
            </p>
          </div>

          <div
            className={`border-2 border-dashed rounded-lg p-10 text-center transition-colors ${
              dragging
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25 hover:border-primary/50"
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="font-medium text-sm">拖曳文件或資料夾至此，或點擊選取</p>
            <p className="text-xs text-muted-foreground mt-1">
              支援 PDF、Word、Excel、PPT、圖片（JPG、PNG）；可直接拖入整個資料夾
            </p>
            <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
              <label className="inline-flex items-center gap-2 cursor-pointer text-sm font-medium border rounded-md px-3 py-1.5 hover:bg-muted transition-colors">
                <Upload className="h-3.5 w-3.5" />
                選擇文件
                <input
                  type="file"
                  multiple
                  accept={acceptedTypes}
                  className="hidden"
                  onChange={handleFileInput}
                />
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer text-sm font-medium border rounded-md px-3 py-1.5 hover:bg-muted transition-colors">
                <FolderOpen className="h-3.5 w-3.5" />
                選擇資料夾
                <input
                  type="file"
                  multiple
                  {...{ webkitdirectory: "" }}
                  className="hidden"
                  onChange={handleFileInput}
                />
              </label>
            </div>
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* 佇列標題 + 開始按鈕 */}
      <div className="flex items-center justify-between">
        <h2 className="font-semibold flex items-center gap-2">
          處理佇列
          <Badge variant="secondary">{queue.length}</Badge>
          {completedCount > 0 && (
            <Badge variant="default" className="text-[10px]">
              {completedCount} 已完成
            </Badge>
          )}
        </h2>
        <div className="flex gap-2">
          {pendingCount > 0 && (
            <Button size="sm" onClick={processQueue} disabled={processing} className="gap-1">
              {processing ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" />處理中...</>
              ) : (
                <><Upload className="h-3.5 w-3.5" />開始處理 ({pendingCount})</>
              )}
            </Button>
          )}
          {completedCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setQueue((prev) => prev.filter((i) => i.status !== "completed"))}
            >
              清除已完成
            </Button>
          )}
        </div>
      </div>

      {/* 佇列列表 */}
      <div className="space-y-2">
        {queue.map((item) => {
          const sc = statusConfig[item.status]
          const Icon = sc.icon
          return (
            <Card key={item.id}>
              <CardContent className="p-3">
                <div className="flex items-center gap-3">
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{item.filename}</p>
                      <Badge
                        variant={item.status === "completed" ? "default" : item.status === "error" ? "destructive" : "outline"}
                        className={`text-[10px] px-1.5 py-0 shrink-0 flex items-center gap-1 ${item.status !== "error" ? sc.color : ""}`}
                      >
                        <Icon className={`h-2.5 w-2.5 ${item.status === "processing" ? "animate-spin" : ""}`} />
                        {sc.label}
                      </Badge>
                    </div>

                    {item.status === "processing" && (
                      <Progress value={item.progress} className="mt-1.5 h-1" />
                    )}
                    {/* 兩階段狀態 */}
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      <StepChip
                        state={item.extractStep}
                        label={`① ${(item.maskRequested ?? maskEnabled) ? "掃描遮罩" : "文字提取"}`}
                      />
                      <StepChip
                        state={item.indexStep}
                        label={
                          item.indexStep === "skipped"
                            ? `② 入庫：略過（${item.indexSkipReason ?? "未指定專案"}）`
                            : "② 入庫"
                        }
                      />
                    </div>

                    {item.extractStep === "done" && (
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {item.extractedChars != null && <>提取 {item.extractedChars.toLocaleString()} 字元</>}
                        {item.method && <> · {item.method}</>}
                        {item.maskRequested && (
                          <span
                            className={`ml-1 inline-flex items-center gap-0.5 ${
                              (item.maskTotal ?? 0) > 0 ? "text-amber-600" : "text-green-600"
                            }`}
                          >
                            · <ShieldCheck className="h-3 w-3" />
                            {!item.masked && item.maskTotal == null
                              ? "後端未回報遮罩結果"
                              : formatMaskSummary(item.maskTotal, item.maskSummary)}
                            {item.maskScope === "project" && "（已寫入專案對照表）"}
                          </span>
                        )}
                      </p>
                    )}
                    {item.extractError && (
                      <p className="text-[11px] text-red-500 mt-0.5">階段①失敗：{item.extractError}</p>
                    )}
                    {item.indexError && (
                      <p className="text-[11px] text-red-500 mt-0.5">階段②失敗：{item.indexError}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {item.extractedText && (
                      <button
                        onClick={() => setPreviewItem(item)}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      onClick={() => remove(item.id)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
        {queue.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            佇列為空，上傳文件後點擊「開始處理」
          </p>
        )}
      </div>

      {/* 提取結果預覽 */}
      {previewItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-6">
          <Card className="w-full max-w-2xl">
            <CardHeader className="flex-row items-center justify-between pb-3">
              <CardTitle className="text-sm">
                {previewItem.filename} — {previewItem.maskRequested ? "遮罩後文字" : "提取結果"}
              </CardTitle>
              <button onClick={() => setPreviewItem(null)}>
                <X className="h-4 w-4 text-muted-foreground hover:text-foreground" />
              </button>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-96">
                <pre className="text-xs whitespace-pre-wrap font-mono leading-relaxed">
                  {previewItem.extractedText}
                </pre>
              </ScrollArea>
              <p className="text-[11px] text-muted-foreground mt-3">
                共 {previewItem.extractedChars?.toLocaleString()} 字元
                {previewItem.maskRequested && (
                  <> · {formatMaskSummary(previewItem.maskTotal, previewItem.maskSummary)}</>
                )}
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

export default function OcrPage() {
  return (
    <Suspense>
      <OcrPageInner />
    </Suspense>
  )
}
