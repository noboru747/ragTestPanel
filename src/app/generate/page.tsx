"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  FileText,
  Loader2,
  Download,
  Sparkles,
  Clock,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  X,
  Database,
  ChevronRight,
} from "lucide-react"

type DocRequest = {
  id: string
  title: string
  doc_type: string
  template_id: string
  project_id: string
  project_name: string
  status: "pending" | "generating" | "completed" | "error"
  created_at: string
  completed_at: string
}

type RequestDetail = {
  md: string
  frontmatter: Record<string, string | Record<string, string>>
  body: string
}

const STATUS_MAP = {
  pending:    { label: "待生成", color: "outline",     icon: Clock },
  generating: { label: "生成中", color: "secondary",   icon: Loader2 },
  completed:  { label: "已完成", color: "default",     icon: CheckCircle2 },
  error:      { label: "失敗",   color: "destructive", icon: AlertCircle },
} as const

export default function GeneratePage() {
  const [requests, setRequests] = useState<DocRequest[]>([])
  const [loading, setLoading]   = useState(true)
  const [selected, setSelected] = useState<DocRequest | null>(null)
  const [detail, setDetail]     = useState<RequestDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [generating, setGenerating]       = useState<string | null>(null) // req id being generated

  const loadRequests = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/requests")
      const data = await res.json()
      setRequests(data.requests ?? [])
    } catch {
      setRequests([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadRequests()
  }, [loadRequests])

  const openDetail = async (req: DocRequest) => {
    setSelected(req)
    setLoadingDetail(true)
    setDetail(null)
    try {
      const res = await fetch(`/api/requests/${req.id}`)
      const data = await res.json()
      setDetail(data)
    } catch {
      setDetail(null)
    } finally {
      setLoadingDetail(false)
    }
  }

  const handleGenerate = async (req: DocRequest) => {
    setGenerating(req.id)
    // update status optimistically
    setRequests((prev) =>
      prev.map((r) => (r.id === req.id ? { ...r, status: "generating" } : r))
    )
    try {
      const res = await fetch(`/api/requests/${req.id}/generate`, {
        method: "POST",
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "生成失敗")
      await loadRequests()
      // reload detail if the same item is open
      if (selected?.id === req.id) {
        openDetail({ ...req, status: "completed" })
      }
    } catch (e) {
      alert(`生成失敗：${e instanceof Error ? e.message : String(e)}`)
      await loadRequests()
    } finally {
      setGenerating(null)
    }
  }

  const handleDownload = (req: DocRequest, md: string) => {
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${req.id}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const resultSection = detail?.body
    ? (() => {
        const parts = detail.body.split("## ✅ 生成結果")
        return parts.length > 1 ? parts[1].trim() : null
      })()
    : null

  const hasRealResult =
    resultSection &&
    !resultSection.includes("（尚未生成") &&
    !resultSection.includes("（生成中")

  return (
    <div className="flex h-full gap-0">
      {/* ── Left: request list ──────────────────────────────────────────── */}
      <div className="w-80 shrink-0 border-r flex flex-col h-full">
        <div className="px-4 py-4 border-b flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold">文件生成紀錄</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {requests.filter((r) => r.status === "completed").length} 份已完成 ·{" "}
              {requests.filter((r) => r.status === "pending").length} 份待生成
            </p>
          </div>
          <button
            onClick={loadRequests}
            className="text-muted-foreground hover:text-foreground transition-colors"
            title="重新整理"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        <ScrollArea className="flex-1">
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-xs p-4">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              載入中...
            </div>
          ) : requests.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 px-4 text-muted-foreground text-xs text-center">
              <FileText className="h-8 w-8 opacity-30" />
              <p>尚無文件需求</p>
              <p>請先至「文件需求管理」頁面建立需求</p>
            </div>
          ) : (
            <div className="divide-y">
              {requests.map((req) => {
                const statusInfo = STATUS_MAP[req.status] ?? STATUS_MAP.pending
                const StatusIcon = statusInfo.icon
                const isActive = selected?.id === req.id
                const isGenerating = generating === req.id

                return (
                  <button
                    key={req.id}
                    onClick={() => openDetail(req)}
                    className={`w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors flex items-start gap-3 ${
                      isActive ? "bg-muted" : ""
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{req.title}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge
                          variant={statusInfo.color as "outline" | "default" | "secondary" | "destructive"}
                          className="text-[10px] px-1.5 py-0 flex items-center gap-0.5"
                        >
                          <StatusIcon className={`h-2.5 w-2.5 mr-0.5 ${isGenerating || req.status === "generating" ? "animate-spin" : ""}`} />
                          {statusInfo.label}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">
                          {req.doc_type}
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {req.created_at ? new Date(req.created_at).toLocaleDateString("zh-TW") : ""}
                      </p>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-1" />
                  </button>
                )
              })}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* ── Right: detail panel ─────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selected ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
            <FileText className="h-12 w-12 opacity-20" />
            <p className="text-sm">從左側選擇一筆文件需求</p>
            <p className="text-xs">可查看 MD 紀錄、觸發 AI 生成或下載結果</p>
          </div>
        ) : (
          <>
            {/* Detail header */}
            <div className="px-6 py-4 border-b flex items-start justify-between gap-4 shrink-0">
              <div className="flex-1 min-w-0">
                <h2 className="font-semibold truncate">{selected.title}</h2>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                  {selected.project_name && (
                    <span className="flex items-center gap-1">
                      <Database className="h-3 w-3" />
                      {selected.project_name}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    建立：{selected.created_at ? new Date(selected.created_at).toLocaleString("zh-TW") : ""}
                  </span>
                  {selected.completed_at && (
                    <span className="flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3 text-green-500" />
                      完成：{new Date(selected.completed_at).toLocaleString("zh-TW")}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {(selected.status === "pending" || selected.status === "error") && (
                  <Button
                    size="sm"
                    className="gap-1"
                    onClick={() => handleGenerate(selected)}
                    disabled={generating === selected.id}
                  >
                    {generating === selected.id ? (
                      <><Loader2 className="h-3.5 w-3.5 animate-spin" />生成中...</>
                    ) : (
                      <><Sparkles className="h-3.5 w-3.5" />開始生成</>
                    )}
                  </Button>
                )}
                {selected.status === "generating" && (
                  <Button size="sm" disabled className="gap-1">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    AI 生成中...
                  </Button>
                )}
                {detail && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    onClick={() => handleDownload(selected, detail.md)}
                  >
                    <Download className="h-3.5 w-3.5" />
                    下載 MD
                  </Button>
                )}
                <button
                  onClick={() => setSelected(null)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Detail content */}
            <ScrollArea className="flex-1 p-6">
              {loadingDetail ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  載入中...
                </div>
              ) : !detail ? (
                <p className="text-sm text-muted-foreground">（讀取失敗）</p>
              ) : (
                <div className="space-y-5">
                  {/* Result section (show prominently if completed) */}
                  {selected.status === "completed" && hasRealResult ? (
                    <>
                      <Card className="border-green-200 bg-green-50/50 dark:border-green-900 dark:bg-green-950/20">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm flex items-center gap-2 text-green-700 dark:text-green-400">
                            <CheckCircle2 className="h-4 w-4" />
                            生成結果
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed">
                            {resultSection}
                          </pre>
                        </CardContent>
                      </Card>
                      <Separator />
                    </>
                  ) : selected.status === "pending" ? (
                    <div className="flex items-start gap-3 bg-muted/50 rounded-lg p-4 text-sm text-muted-foreground">
                      <Clock className="h-4 w-4 mt-0.5 shrink-0" />
                      <div>
                        <p className="font-medium text-foreground">尚未生成</p>
                        <p className="text-xs mt-0.5">點選右上角「開始生成」按鈕，AI 將從知識庫讀取相關資料並生成文件</p>
                      </div>
                    </div>
                  ) : selected.status === "generating" ? (
                    <div className="flex items-start gap-3 bg-muted/50 rounded-lg p-4 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 mt-0.5 shrink-0 animate-spin" />
                      <div>
                        <p className="font-medium text-foreground">AI 生成中</p>
                        <p className="text-xs mt-0.5">正在讀取知識庫並生成文件，預計需要 30–120 秒</p>
                      </div>
                    </div>
                  ) : selected.status === "error" ? (
                    <div className="flex items-start gap-3 bg-destructive/10 rounded-lg p-4 text-sm text-destructive">
                      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                      <div>
                        <p className="font-medium">生成失敗</p>
                        <p className="text-xs mt-0.5">請確認 Docker 服務運行中後點選「開始生成」重試</p>
                      </div>
                    </div>
                  ) : null}

                  {/* Raw MD content */}
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                      MD 需求紀錄
                    </p>
                    <Card>
                      <CardContent className="p-4">
                        <pre className="text-xs whitespace-pre-wrap font-mono leading-relaxed text-foreground/70">
                          {detail.md}
                        </pre>
                      </CardContent>
                    </Card>
                    <p className="text-[10px] text-muted-foreground mt-2">
                      儲存路徑：backend/requests/{selected.id}.md
                    </p>
                  </div>
                </div>
              )}
            </ScrollArea>
          </>
        )}
      </div>
    </div>
  )
}
