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
  Wrench,
  AlertTriangle,
  ChevronRight,
  Sparkles,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { BackendErrorBanner } from "@/components/backend-error-banner"
import { fetchJson } from "@/lib/backend-fetch"
import { formatMaskSummary } from "@/lib/mask"
import { InlineSpinner } from "@/components/loading"
import {
  ERROR_CODE_INFO,
  formatRepairs,
  isRepairableCode,
  suspicionOf,
  toErrorInfo,
  type ErrorInfo,
  type ExtractDiagnostics,
} from "@/lib/ocr-diagnostics"
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
  /** 結構化錯誤（error_code / reason / hint / detail） */
  extractErrorInfo?: ErrorInfo
  indexErrorInfo?: ErrorInfo
  /** 後端 extract 的診斷資訊 */
  diagnostics?: ExtractDiagnostics
  /** 處理時使用的專案（修復重跑沿用） */
  projectIdUsed?: string
  /** 修復重跑中 */
  repairing?: boolean
  /** 已執行過幾次「排除故障並重新上傳」 */
  repairAttempts?: number
  /** 後端回報的修復結果 */
  repaired?: boolean
  repairsApplied?: string[]
}

/** 單一階段狀態：待處理 / 進行中 / 完成 / 失敗 / 略過 */
type StepState = "pending" | "running" | "done" | "error" | "skipped"

const MASK_STORAGE_KEY = "ocr.maskEnabled"

async function readErrorInfo(res: Response, fallback: string): Promise<ErrorInfo> {
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  return toErrorInfo(body, fallback, res.status)
}

function connError(message: string, e: unknown): ErrorInfo {
  return { message, detail: e instanceof Error ? e.message : String(e) }
}

/** 該項目是否可「排除故障並重新上傳」，以及可疑警示文字 */
function repairStateOf(item: OcrItem): { repairable: boolean; warning: string | null } {
  if (item.status === "error") {
    const code = item.extractErrorInfo?.code ?? item.indexErrorInfo?.code
    return { repairable: isRepairableCode(code), warning: null }
  }
  if (item.status === "completed" && item.extractStep === "done") {
    const warning = suspicionOf(item.diagnostics, item.extractedChars)
    return { repairable: warning != null, warning }
  }
  return { repairable: false, warning: null }
}

/** 失敗項目的錯誤詳情面板 */
function ErrorDetailPanel({ stage, info }: { stage: string; info: ErrorInfo }) {
  const known = info.code ? ERROR_CODE_INFO[info.code] : undefined
  return (
    <div className="mt-1.5 rounded-md border border-red-200 bg-red-50/60 dark:border-red-900 dark:bg-red-950/20 px-2.5 py-2 space-y-1.5 text-[11px] leading-relaxed">
      <p className="font-medium text-red-700 dark:text-red-400">
        {stage}：{known?.title ?? info.message}
        {info.code && (
          <span className="ml-1.5 font-mono font-normal text-[10px] text-red-500/80">[{info.code}]</span>
        )}
      </p>
      {known && <p className="text-muted-foreground">{known.explain}</p>}
      {info.reason && (
        <p>
          <span className="text-muted-foreground">原因：</span>
          {info.reason}
        </p>
      )}
      {info.hint && (
        <p>
          <span className="text-muted-foreground">建議：</span>
          {info.hint}
        </p>
      )}
      {info.detail && (
        <details>
          <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground w-fit">
            技術細節
          </summary>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-background/80 border px-2 py-1.5 font-mono text-[10px]">
            {info.detail}
          </pre>
        </details>
      )}
    </div>
  )
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
  const [batchRepairing, setBatchRepairing] = useState(false)
  /** 已展開錯誤詳情的項目 */
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const busy = processing || batchRepairing || queue.some((i) => i.repairing)
  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

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

  /**
   * 跑單一項目的兩階段：① POST /api/ocr（提取＋遮罩，不入庫） → ② POST /api/documents/index（用遮罩後文字入庫）
   * repair=true 時階段①請後端套用修復。
   */
  const runItem = async (
    item: OcrItem,
    opts: { mask: boolean; projectId: string; repair: boolean }
  ) => {
    const { mask, projectId, repair } = opts
    patch(item.id, {
      status: "processing",
      progress: 20,
      extractStep: "running",
      indexStep: "pending",
      maskRequested: mask,
      projectIdUsed: projectId,
      error: undefined,
      extractError: undefined,
      indexError: undefined,
      extractErrorInfo: undefined,
      indexErrorInfo: undefined,
      indexSkipReason: undefined,
      diagnostics: undefined,
      repaired: undefined,
      repairsApplied: undefined,
      ...(repair ? { extractedText: undefined, extractedChars: null, method: undefined } : {}),
    })

    const failExtract = (info: ErrorInfo) =>
      patch(item.id, {
        status: "error",
        progress: 0,
        extractStep: "error",
        extractError: info.message,
        extractErrorInfo: info,
        error: info.message,
      })
    const failIndex = (info: ErrorInfo) =>
      patch(item.id, {
        status: "error",
        progress: 0,
        indexStep: "error",
        indexError: info.message,
        indexErrorInfo: info,
        error: info.message,
      })

    // ── 階段①：掃描遮罩 / 文字提取 ──
    let text = ""
    try {
      const form = new FormData()
      form.append("file", item.file, item.filename)
      form.append("mask", mask ? "true" : "false")
      form.append("index", "false")
      form.append("repair", repair ? "true" : "false")
      // 有選專案時一併轉給後端，讓遮罩代號在專案內統一編號並寫入本機對照表
      if (projectId) form.append("project_id", projectId)

      const res = await fetch("/api/ocr", { method: "POST", body: form })
      if (!res.ok) {
        failExtract(await readErrorInfo(res, "文字提取失敗"))
        return
      }
      const data = await res.json()
      if (!data?.success) {
        failExtract(toErrorInfo(data, "文字提取失敗", res.status))
        return
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
        diagnostics: data.diagnostics && typeof data.diagnostics === "object" ? data.diagnostics : undefined,
        repaired: typeof data.repaired === "boolean" ? data.repaired : undefined,
        repairsApplied: Array.isArray(data.repairs_applied) ? data.repairs_applied : undefined,
      })
    } catch (e) {
      failExtract(connError("無法連線到伺服器", e))
      return
    }

    // ── 階段②：入庫 ──
    if (!projectId) {
      patch(item.id, { status: "completed", progress: 100, indexStep: "skipped", indexSkipReason: "未指定專案" })
      return
    }
    if (!text.trim()) {
      patch(item.id, { status: "completed", progress: 100, indexStep: "skipped", indexSkipReason: "無可入庫文字" })
      return
    }
    patch(item.id, { progress: 75, indexStep: "running" })
    try {
      const res = await fetch("/api/documents/index", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, filename: item.filename, text }),
      })
      if (!res.ok) {
        failIndex(await readErrorInfo(res, "入庫失敗"))
      } else {
        patch(item.id, { status: "completed", progress: 100, indexStep: "done" })
      }
    } catch (e) {
      failIndex(connError("入庫時無法連線到伺服器", e))
    }
  }

  const processQueue = async () => {
    const pending = queue.filter((i) => i.status === "queued")
    if (!pending.length || busy) return
    setProcessing(true)
    // 以按下「開始處理」當下的設定為準，處理途中切換不影響本批次
    const mask = maskEnabled
    const projectId = selectedProjectId
    for (const item of pending) {
      await runItem(item, { mask, projectId, repair: false })
    }
    setProcessing(false)
  }

  /** 排除故障並重新上傳：同一個 File、沿用原本的遮罩設定與專案，階段①帶 repair=true；不自動再重試 */
  const repairOne = async (item: OcrItem) => {
    patch(item.id, { repairing: true, repairAttempts: (item.repairAttempts ?? 0) + 1 })
    try {
      await runItem(item, {
        mask: item.maskRequested ?? maskEnabled,
        projectId: item.projectIdUsed ?? "",
        repair: true,
      })
    } finally {
      patch(item.id, { repairing: false })
    }
  }

  const repairAll = async (items: OcrItem[]) => {
    if (!items.length || busy) return
    setBatchRepairing(true)
    try {
      // 依序處理，不併發
      for (const item of items) await repairOne(item)
    } finally {
      setBatchRepairing(false)
    }
  }

  const acceptedTypes = ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.gif,.webp"
  const pendingCount = queue.filter((i) => i.status === "queued").length
  const completedCount = queue.filter((i) => i.status === "completed").length
  // 批次修復只納入尚未修復過的項目（修復過仍失敗者需手動再試，避免反覆重跑）
  const batchRepairItems = queue.filter((i) => !i.repairAttempts && repairStateOf(i).repairable)

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
                  disabled={projectsLoading || busy}
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
                disabled={busy}
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
        <div className="flex gap-2 flex-wrap justify-end">
          {(batchRepairItems.length > 0 || batchRepairing) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => repairAll(batchRepairItems)}
              disabled={busy}
              className="gap-1 border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-950/30"
            >
              {batchRepairing ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" />排除故障中...</>
              ) : (
                <><Wrench className="h-3.5 w-3.5" />全部排除故障並重新上傳（{batchRepairItems.length} 項）</>
              )}
            </Button>
          )}
          {pendingCount > 0 && (
            <Button size="sm" onClick={processQueue} disabled={busy} className="gap-1">
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
              disabled={busy}
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
          const { repairable, warning } = repairStateOf(item)
          const hasError = item.status === "error" && !!(item.extractErrorInfo || item.indexErrorInfo || item.error)
          const isOpen = expanded.has(item.id)
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
                    {/* 修復結果 */}
                    {(item.repairAttempts ?? 0) > 0 && !item.repairing && item.extractStep === "done" && (
                      <p className="text-[11px] text-blue-600 dark:text-blue-400 mt-0.5 flex items-center gap-1">
                        <Sparkles className="h-3 w-3 shrink-0" />
                        {item.repaired === undefined && item.repairsApplied === undefined
                          ? "已以修復模式重新處理（後端未回報修復項目）"
                          : `已套用修復：${formatRepairs(item.repairsApplied)}`}
                      </p>
                    )}

                    {/* 可疑警示（未失敗） */}
                    {warning && !item.repairing && (
                      <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        {warning}
                        {item.indexStep === "done" && "，內容仍已入庫"}
                      </p>
                    )}

                    {/* 失敗摘要 + 錯誤詳情 */}
                    {hasError && !item.repairing && (
                      <>
                        <button
                          type="button"
                          onClick={() => toggleExpanded(item.id)}
                          className="mt-0.5 flex items-start gap-1 text-left text-[11px] text-red-600 dark:text-red-400 hover:underline"
                          aria-expanded={isOpen}
                        >
                          {isOpen ? (
                            <ChevronDown className="h-3 w-3 mt-0.5 shrink-0" />
                          ) : (
                            <ChevronRight className="h-3 w-3 mt-0.5 shrink-0" />
                          )}
                          <span>
                            {item.extractStep === "error" ? "階段①失敗" : "階段②失敗"}：
                            {item.extractErrorInfo?.message ?? item.indexErrorInfo?.message ?? item.error}
                            <span className="ml-1 text-muted-foreground">（{isOpen ? "收合" : "錯誤詳情"}）</span>
                          </span>
                        </button>
                        {isOpen && item.extractErrorInfo && (
                          <ErrorDetailPanel stage="階段① 掃描/提取" info={item.extractErrorInfo} />
                        )}
                        {isOpen && item.indexErrorInfo && (
                          <ErrorDetailPanel stage="階段② 入庫" info={item.indexErrorInfo} />
                        )}
                        {(item.repairAttempts ?? 0) > 0 && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            已嘗試排除故障 {item.repairAttempts} 次仍失敗；請依錯誤詳情的建議處理，或手動再試一次。
                          </p>
                        )}
                      </>
                    )}

                    {(repairable || item.repairing) && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => repairOne(item)}
                        disabled={busy}
                        className="mt-1.5 h-7 gap-1 text-[11px] border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-950/30"
                      >
                        {item.repairing ? (
                          <><Loader2 className="h-3 w-3 animate-spin" />排除故障中...</>
                        ) : (
                          <>
                            <Wrench className="h-3 w-3" />
                            {(item.repairAttempts ?? 0) > 0 ? "再試一次排除故障" : "排除故障並重新上傳"}
                          </>
                        )}
                      </Button>
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
                      disabled={item.repairing || item.status === "processing"}
                      className="text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
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
