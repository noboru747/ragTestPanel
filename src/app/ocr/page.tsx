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
} from "lucide-react"
import { Button } from "@/components/ui/button"
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

  // 從 URL query param 預選專案（從專案詳情頁導過來時）
  useEffect(() => {
    const pid = searchParams.get("projectId")
    if (pid) setSelectedProjectId(pid)
  }, [searchParams])

  // 從後端載入真實專案清單
  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data) => {
        const list: ProjectOption[] = (data.projects ?? data ?? []).map(
          (p: { id: string; name: string }) => ({ id: p.id, name: p.name })
        )
        setProjects(list)
      })
      .catch(() => {})
  }, [])

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

  const processQueue = async () => {
    const pending = queue.filter((i) => i.status === "queued")
    if (!pending.length || processing) return
    setProcessing(true)

    for (const item of pending) {
      // 設為處理中
      setQueue((prev) =>
        prev.map((i) => i.id === item.id ? { ...i, status: "processing", progress: 30 } : i)
      )

      try {
        const form = new FormData()
        form.append("file", item.file, item.filename)
        if (selectedProjectId) form.append("project_id", selectedProjectId)

        const res = await fetch("/api/ocr", { method: "POST", body: form })
        const data = await res.json()

        if (!res.ok || !data.success) {
          setQueue((prev) =>
            prev.map((i) =>
              i.id === item.id
                ? { ...i, status: "error", progress: 0, error: data.error ?? "處理失敗" }
                : i
            )
          )
        } else {
          setQueue((prev) =>
            prev.map((i) =>
              i.id === item.id
                ? {
                    ...i,
                    status: "completed",
                    progress: 100,
                    extractedChars: data.char_count,
                    extractedText: data.text,
                  }
                : i
            )
          )
        }
      } catch {
        setQueue((prev) =>
          prev.map((i) =>
            i.id === item.id
              ? { ...i, status: "error", progress: 0, error: "網路錯誤" }
              : i
          )
        )
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
                  className="appearance-none text-xs border rounded-md px-2.5 py-1 pr-6 bg-background hover:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
                >
                  <option value="">不指定專案（不入庫）</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
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
                    {item.status === "completed" && item.extractedChars != null && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        提取 {item.extractedChars.toLocaleString()} 字元 · {item.model}
                      </p>
                    )}
                    {item.status === "error" && (
                      <p className="text-[11px] text-red-500 mt-0.5">{item.error}</p>
                    )}
                    {item.status === "queued" && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        等待處理 · {item.model}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {item.status === "completed" && item.extractedText && (
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
              <CardTitle className="text-sm">{previewItem.filename} — 提取結果</CardTitle>
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
