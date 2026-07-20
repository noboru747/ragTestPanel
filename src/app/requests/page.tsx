"use client"

export const runtime = 'edge'

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  ClipboardList,
  Plus,
  ChevronRight,
  Trash2,
  FileText,
  Sparkles,
  ChevronDown,
  X,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Eye,
} from "lucide-react"
import { mockTemplates, type DocumentTemplate } from "@/lib/mock-templates"

type Project = { id: string; name: string }
type FormValues = Record<string, string>

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

const STATUS_MAP = {
  pending:    { label: "待生成", color: "outline",     icon: Clock },
  generating: { label: "生成中", color: "secondary",   icon: Loader2 },
  completed:  { label: "已完成", color: "default",     icon: CheckCircle2 },
  error:      { label: "失敗",   color: "destructive", icon: AlertCircle },
} as const

export default function RequestsPage() {
  const [requests, setRequests] = useState<DocRequest[]>([])
  const [loading, setLoading]   = useState(true)
  const [projects, setProjects] = useState<Project[]>([])

  // dialog state
  const [open, setOpen]               = useState(false)
  const [step, setStep]               = useState<"template" | "form">("template")
  const [chosenTemplate, setChosen]   = useState<DocumentTemplate | null>(null)
  const [formValues, setFormValues]   = useState<FormValues>({})
  const [saving, setSaving]           = useState(false)

  // preview drawer
  const [preview, setPreview]   = useState<DocRequest | null>(null)
  const [previewMd, setPreviewMd] = useState<string>("")
  const [loadingMd, setLoadingMd] = useState(false)

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
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => setProjects(d.projects ?? d ?? []))
      .catch(() => {})
  }, [loadRequests])

  const openDialog = () => {
    setStep("template")
    setChosen(null)
    setFormValues({})
    setOpen(true)
  }

  const selectTemplate = (tmpl: DocumentTemplate) => {
    setChosen(tmpl)
    setStep("form")
    setFormValues({})
  }

  const handleSubmit = async () => {
    if (!chosenTemplate) return
    setSaving(true)
    try {
      const projectId = formValues["_project_id"] ?? ""
      const projectName = projects.find((p) => p.id === projectId)?.name ?? ""
      const title =
        formValues["tender_name"] ||
        formValues["project_name"] ||
        formValues["subject"] ||
        formValues["system_name"] ||
        `${chosenTemplate.name} — ${new Date().toLocaleDateString("zh-TW")}`

      const form_data: FormValues = {}
      for (const f of chosenTemplate.fields) {
        if (formValues[f.key]) form_data[f.key] = formValues[f.key]
      }

      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          doc_type: chosenTemplate.category,
          template_id: chosenTemplate.id,
          project_id: projectId,
          project_name: projectName,
          form_data,
        }),
      })
      if (!res.ok) throw new Error("儲存失敗")
      setOpen(false)
      await loadRequests()
    } catch (e) {
      alert(`建立失敗：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm("確定要刪除這筆文件需求？")) return
    await fetch(`/api/requests/${id}`, { method: "DELETE" })
    await loadRequests()
  }

  const openPreview = async (req: DocRequest) => {
    setPreview(req)
    setLoadingMd(true)
    try {
      const res = await fetch(`/api/requests/${req.id}`)
      const data = await res.json()
      setPreviewMd(data.md ?? "")
    } catch {
      setPreviewMd("（讀取失敗）")
    } finally {
      setLoadingMd(false)
    }
  }

  const requiredFilled = chosenTemplate
    ? chosenTemplate.fields.filter((f) => f.required).every((f) => formValues[f.key]?.trim())
    : false

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardList className="h-6 w-6" />
            文件需求管理
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            建立文件需求表單，以 MD 格式儲存至後台，再前往「文件生成紀錄」觸發 AI 生成
          </p>
        </div>
        <Button onClick={openDialog} className="gap-2">
          <Plus className="h-4 w-4" />
          建立文件需求
        </Button>
      </div>

      {/* Requests list */}
      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" />
          載入中...
        </div>
      ) : requests.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
            <ClipboardList className="h-10 w-10 opacity-30" />
            <p className="text-sm">尚無文件需求</p>
            <Button variant="outline" size="sm" onClick={openDialog} className="gap-1">
              <Plus className="h-3.5 w-3.5" />
              建立第一個文件需求
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {requests.map((req) => {
            const statusInfo = STATUS_MAP[req.status] ?? STATUS_MAP.pending
            const StatusIcon = statusInfo.icon
            return (
              <Card key={req.id} className="hover:border-primary/40 transition-colors">
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-medium text-sm truncate">{req.title}</p>
                      <Badge
                        variant={statusInfo.color as "outline" | "default" | "secondary" | "destructive"}
                        className="text-[10px] px-1.5 py-0 flex items-center gap-1 shrink-0"
                      >
                        <StatusIcon className={`h-2.5 w-2.5 ${req.status === "generating" ? "animate-spin" : ""}`} />
                        {statusInfo.label}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <FileText className="h-3 w-3" />
                        {req.doc_type}
                      </span>
                      {req.project_name && (
                        <span className="flex items-center gap-1">
                          <Sparkles className="h-3 w-3" />
                          {req.project_name}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {req.created_at ? new Date(req.created_at).toLocaleString("zh-TW") : ""}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1 text-xs"
                      onClick={() => openPreview(req)}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      預覽 MD
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDelete(req.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* ── Create Dialog ─────────────────────────────────────────────────── */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
            {/* Dialog header */}
            <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
              <h2 className="font-semibold">
                {step === "template" ? "選擇文件模板" : `填寫需求：${chosenTemplate?.name}`}
              </h2>
              <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Dialog body */}
            <ScrollArea className="flex-1">
              <div className="p-5 space-y-4">
                {step === "template" && (
                  <>
                    <p className="text-sm text-muted-foreground">選擇要建立的文件類型</p>
                    <div className="space-y-2">
                      {mockTemplates.map((tmpl) => (
                        <button
                          key={tmpl.id}
                          onClick={() => selectTemplate(tmpl)}
                          className={`w-full text-left border rounded-lg px-4 py-3 hover:border-primary/50 hover:bg-primary/5 transition-colors flex items-center gap-3 ${
                            tmpl.ragEnabled ? "border-primary/30 bg-primary/5" : ""
                          }`}
                        >
                          {tmpl.ragEnabled ? (
                            <Sparkles className="h-4 w-4 text-primary shrink-0" />
                          ) : (
                            <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">{tmpl.name}</p>
                            <p className="text-xs text-muted-foreground truncate">{tmpl.description}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Badge variant="outline" className="text-[10px]">{tmpl.category}</Badge>
                            {tmpl.ragEnabled && <Badge className="text-[10px]">RAG</Badge>}
                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                          </div>
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {step === "form" && chosenTemplate && (
                  <div className="space-y-4">
                    {chosenTemplate.ragEnabled && (
                      <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
                        <Sparkles className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                        <span>此需求會使用知識庫 RAG 生成，提交後需至「文件生成紀錄」頁面觸發 AI 生成</span>
                      </div>
                    )}

                    {chosenTemplate.fields.map((field) => (
                      <div key={field.key} className="space-y-1.5">
                        <label className="text-sm font-medium flex items-center gap-1">
                          {field.label}
                          {field.required && <span className="text-destructive">*</span>}
                        </label>

                        {field.type === "project_select" && (
                          <div className="relative">
                            <select
                              value={formValues[field.key] ?? ""}
                              onChange={(e) => setFormValues((p) => ({ ...p, [field.key]: e.target.value }))}
                              className="w-full appearance-none border rounded-md px-3 py-2 pr-8 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                            >
                              <option value="">請選擇專案知識庫...</option>
                              {projects.map((p) => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                              ))}
                            </select>
                            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                          </div>
                        )}

                        {field.type === "select" && (
                          <div className="relative">
                            <select
                              value={formValues[field.key] ?? ""}
                              onChange={(e) => setFormValues((p) => ({ ...p, [field.key]: e.target.value }))}
                              className="w-full appearance-none border rounded-md px-3 py-2 pr-8 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                            >
                              <option value="">請選擇...</option>
                              {field.options?.map((opt) => (
                                <option key={opt} value={opt}>{opt}</option>
                              ))}
                            </select>
                            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                          </div>
                        )}

                        {field.type === "textarea" && (
                          <Textarea
                            placeholder={field.placeholder}
                            value={formValues[field.key] ?? ""}
                            onChange={(e) => setFormValues((p) => ({ ...p, [field.key]: e.target.value }))}
                            rows={3}
                          />
                        )}

                        {(field.type === "text" || field.type === "number" || field.type === "date") && (
                          <Input
                            type={field.type}
                            placeholder={field.placeholder}
                            value={formValues[field.key] ?? ""}
                            onChange={(e) => setFormValues((p) => ({ ...p, [field.key]: e.target.value }))}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </ScrollArea>

            {/* Dialog footer */}
            {step === "form" && (
              <div className="flex items-center justify-between px-5 py-4 border-t shrink-0">
                <Button variant="ghost" size="sm" onClick={() => setStep("template")}>
                  返回選擇模板
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={!requiredFilled || saving}
                  className="gap-2"
                >
                  {saving ? (
                    <><Loader2 className="h-4 w-4 animate-spin" />儲存中...</>
                  ) : (
                    <><ClipboardList className="h-4 w-4" />儲存文件需求</>
                  )}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── MD Preview Drawer ─────────────────────────────────────────────── */}
      {preview && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/30" onClick={() => setPreview(null)} />
          <div className="w-full max-w-xl bg-background shadow-xl flex flex-col h-full">
            <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
              <div>
                <p className="font-semibold text-sm">{preview.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {preview.created_at ? new Date(preview.created_at).toLocaleString("zh-TW") : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={() => {
                    const blob = new Blob([previewMd], { type: "text/markdown;charset=utf-8" })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement("a")
                    a.href = url
                    a.download = `${preview.id}.md`
                    a.click()
                    URL.revokeObjectURL(url)
                  }}
                >
                  下載 MD
                </Button>
                <button onClick={() => setPreview(null)} className="text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <ScrollArea className="flex-1 p-5">
              {loadingMd ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  載入中...
                </div>
              ) : (
                <pre className="text-xs whitespace-pre-wrap font-mono leading-relaxed text-foreground/80">
                  {previewMd}
                </pre>
              )}
            </ScrollArea>
            <Separator />
            <div className="px-5 py-3 text-xs text-muted-foreground shrink-0">
              儲存路徑：backend/requests/{preview.id}.md
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
