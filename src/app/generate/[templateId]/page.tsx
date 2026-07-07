"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  ArrowLeft,
  FileText,
  ImagePlus,
  Loader2,
  Printer,
  Sparkles,
  X,
} from "lucide-react"

/* ─── types ────────────────────────────────────────────────────── */

type FieldType = "text" | "number" | "date" | "textarea"

type TemplateField = {
  key: string
  label: string
  type: FieldType
}

type Template = {
  id: string
  name: string
  fields: TemplateField[]
}

type Project = {
  id: string
  name: string
}

type Section = {
  title: string
  content: string
  images: string[] // data-URL base64
}

type GenerateResult = {
  template_name: string
  content: string
  sources?: string[]
}

type Phase = "form" | "generating" | "result"

/* ─── helpers ──────────────────────────────────────────────────── */

/** Split content string by "## " headings into sections. */
function parseSections(content: string): Omit<Section, "images">[] {
  // Normalise line endings
  const text = content.replace(/\r\n/g, "\n")
  // Split at every line that starts with "## "
  const chunks = text.split(/\n(?=## )/)
  return chunks
    .map((chunk) => {
      const lines = chunk.split("\n")
      const firstLine = lines[0].trimEnd()
      const title = firstLine.startsWith("## ")
        ? firstLine.slice(3).trim()
        : firstLine.trim()
      const body = lines.slice(1).join("\n").trim()
      return { title, content: body }
    })
    .filter((s) => s.title)
}

/* ─── print styles injected at runtime ────────────────────────── */
const PRINT_CSS = `
@media print {
  /* Hide sidebar and chrome */
  aside,
  nav,
  [data-print-hide],
  .print-hide {
    display: none !important;
  }
  /* Expand main to full width */
  main {
    overflow: visible !important;
  }
  body, html {
    height: auto !important;
    overflow: visible !important;
  }
  /* Section cards: avoid mid-card page breaks */
  [data-section-card] {
    break-inside: avoid;
    page-break-inside: avoid;
    border: 1px solid #ccc !important;
    box-shadow: none !important;
    margin-bottom: 24px;
  }
  /* Images stay with their section */
  [data-section-card] img {
    max-width: 100%;
    break-before: avoid;
    page-break-before: avoid;
  }
  /* Toolbar always hidden */
  [data-toolbar] {
    display: none !important;
  }
}
`

/* ─── page ─────────────────────────────────────────────────────── */

export default function GenerateFromTemplatePage({
  params,
}: {
  params: Promise<{ templateId: string }>
}) {
  const router = useRouter()

  /* resolved params */
  const [templateId, setTemplateId] = useState<string | null>(null)

  /* data */
  const [template, setTemplate] = useState<Template | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [loadError, setLoadError] = useState("")

  /* form state */
  const [projectId, setProjectId] = useState("")
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})

  /* generation */
  const [phase, setPhase] = useState<Phase>("form")
  const [genError, setGenError] = useState("")
  const [sections, setSections] = useState<Section[]>([])

  /* PDF dialog */
  const [pdfDialogOpen, setPdfDialogOpen] = useState(false)

  /* hidden file-input refs (one per section, allocated lazily) */
  const fileInputRefs = useRef<Array<HTMLInputElement | null>>([])

  /* ── inject print CSS once ─────────────────────────────────── */
  useEffect(() => {
    const el = document.createElement("style")
    el.textContent = PRINT_CSS
    document.head.appendChild(el)
    return () => { document.head.removeChild(el) }
  }, [])

  /* ── resolve params ────────────────────────────────────────── */
  useEffect(() => {
    params.then(({ templateId }) => setTemplateId(templateId))
  }, [params])

  /* ── load template + projects ──────────────────────────────── */
  useEffect(() => {
    if (!templateId) return

    fetch(`/api/templates/${templateId}`)
      .then((r) => r.json())
      .then((d) => {
        const t: Template = d.template ?? d
        if (!t?.id) throw new Error("模板不存在")
        setTemplate(t)
        // pre-fill field values with empty strings
        const init: Record<string, string> = {}
        t.fields.forEach((f) => { init[f.key] = "" })
        setFieldValues(init)
      })
      .catch(() => setLoadError("無法載入模板，請確認後端服務是否運行"))

    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => {
        const list: Project[] = d.projects ?? []
        setProjects(list)
        if (list.length > 0) setProjectId(list[0].id)
      })
      .catch(() => {})
  }, [templateId])

  /* ── generate ──────────────────────────────────────────────── */
  const handleGenerate = async () => {
    if (!template) return
    if (!projectId) {
      setGenError("請先選擇專案")
      return
    }
    setPhase("generating")
    setGenError("")
    try {
      const res = await fetch("/api/generate/from-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template_id: template.id,
          project_id: projectId,
          fields: fieldValues,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? "生成失敗")
      }
      const data: GenerateResult = await res.json()
      const parsed = parseSections(data.content).map((s) => ({ ...s, images: [] }))
      setSections(parsed)
      setPhase("result")
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "生成失敗")
      setPhase("form")
    }
  }

  /* ── image handling ────────────────────────────────────────── */
  const triggerImagePick = (idx: number) => {
    fileInputRefs.current[idx]?.click()
  }

  const handleFileChange = (idx: number, file: File | undefined) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string
      setSections((prev) =>
        prev.map((s, i) =>
          i === idx ? { ...s, images: [...s.images, dataUrl] } : s
        )
      )
    }
    reader.readAsDataURL(file)
  }

  const removeImage = (sectionIdx: number, imgIdx: number) => {
    setSections((prev) =>
      prev.map((s, i) =>
        i === sectionIdx
          ? { ...s, images: s.images.filter((_, j) => j !== imgIdx) }
          : s
      )
    )
  }

  /* ── print / PDF ────────────────────────────────────────────── */
  const handlePrint = () => {
    window.print()
  }

  const handlePdfPreview = () => {
    setPdfDialogOpen(true)
  }

  /* ── field input renderer ───────────────────────────────────── */
  const renderField = (field: TemplateField) => {
    const val = fieldValues[field.key] ?? ""
    const onChange = (v: string) =>
      setFieldValues((prev) => ({ ...prev, [field.key]: v }))

    if (field.type === "textarea") {
      return (
        <textarea
          key={field.key}
          value={val}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          placeholder={field.label}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
        />
      )
    }
    return (
      <Input
        key={field.key}
        type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
        value={val}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.label}
      />
    )
  }

  /* ── loading / error state ─────────────────────────────────── */
  if (loadError) {
    return (
      <div className="p-8 flex flex-col items-center gap-4 text-center">
        <FileText className="h-12 w-12 text-muted-foreground opacity-40" />
        <p className="text-sm text-destructive">{loadError}</p>
        <Button variant="outline" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          返回
        </Button>
      </div>
    )
  }

  if (!template) {
    return (
      <div className="p-8 flex items-center gap-3 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        載入模板中...
      </div>
    )
  }

  /* ══════════════════════════════════════════════════════════════
     PHASE: form
  ══════════════════════════════════════════════════════════════ */
  if (phase === "form") {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-6" data-print-hide>
        {/* Back */}
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          返回
        </button>

        {/* Title */}
        <div>
          <h1 className="text-2xl font-bold">生成{template.name}</h1>
          <p className="text-muted-foreground text-sm mt-1">
            填寫欄位後，AI 將根據專案文件自動生成文件
          </p>
        </div>

        <Card>
          <CardContent className="p-6 space-y-5">
            {/* Project selector */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">選擇專案</label>
              {projects.length === 0 ? (
                <p className="text-xs text-muted-foreground">（載入專案清單中...）</p>
              ) : (
                <select
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Template fields */}
            {template.fields.length > 0 && (
              <div className="space-y-4">
                <p className="text-sm font-medium">填寫欄位</p>
                {template.fields.map((field) => (
                  <div key={field.key} className="space-y-1.5">
                    <label className="text-sm text-muted-foreground">{field.label}</label>
                    {renderField(field)}
                  </div>
                ))}
              </div>
            )}

            {genError && (
              <p className="text-sm text-destructive">{genError}</p>
            )}

            <Button
              className="w-full gap-2"
              onClick={handleGenerate}
              disabled={!projectId}
            >
              <Sparkles className="h-4 w-4" />
              生成{template.name}
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  /* ══════════════════════════════════════════════════════════════
     PHASE: generating
  ══════════════════════════════════════════════════════════════ */
  if (phase === "generating") {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 p-8" data-print-hide>
        <Loader2 className="h-12 w-12 text-primary animate-spin" />
        <div className="text-center space-y-1.5">
          <p className="font-semibold">正在根據專案文件生成{template.name}，請稍候...</p>
          <p className="text-sm text-muted-foreground">AI 讀取知識庫中，預計需要 30–120 秒</p>
        </div>
      </div>
    )
  }

  /* ══════════════════════════════════════════════════════════════
     PHASE: result
  ══════════════════════════════════════════════════════════════ */
  return (
    <>
      {/* ── Toolbar ─────────────────────────────────────────────── */}
      <div
        data-toolbar
        data-print-hide
        className="sticky top-0 z-10 flex items-center justify-between border-b bg-background/95 backdrop-blur px-6 py-3 print:hidden"
      >
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          返回
        </button>
        <h2 className="font-semibold text-sm">{template.name}</h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handlePdfPreview} className="gap-1.5">
            <FileText className="h-4 w-4" />
            預覽 PDF
          </Button>
          <Button variant="outline" size="sm" onClick={handlePrint} className="gap-1.5">
            <Printer className="h-4 w-4" />
            列印
          </Button>
        </div>
      </div>

      {/* ── Document body ────────────────────────────────────────── */}
      <div className="p-6 max-w-4xl mx-auto space-y-6 pb-16">
        {/* Document title */}
        <h1 className="text-2xl font-bold print:text-3xl">{template.name}</h1>

        {sections.map((section, idx) => (
          <Card key={idx} data-section-card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{section.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Section text */}
              <pre className="whitespace-pre-wrap text-sm font-sans leading-relaxed text-foreground/90">
                {section.content}
              </pre>

              {/* Inserted images */}
              {section.images.length > 0 && (
                <div className="space-y-3">
                  {section.images.map((src, imgIdx) => (
                    <div key={imgIdx} className="relative inline-block">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={src}
                        alt={`插入圖片 ${imgIdx + 1}`}
                        className="max-w-full rounded border"
                        style={{ maxHeight: "480px", objectFit: "contain" }}
                      />
                      <button
                        data-print-hide
                        onClick={() => removeImage(idx, imgIdx)}
                        className="absolute top-1 right-1 rounded-full bg-black/60 text-white p-0.5 hover:bg-black/80 print:hidden"
                        title="刪除圖片"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Insert image button */}
              <div data-print-hide className="print:hidden">
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  ref={(el) => { fileInputRefs.current[idx] = el }}
                  onChange={(e) => handleFileChange(idx, e.target.files?.[0])}
                  // reset value so same file can be re-selected
                  onClick={(e) => { (e.target as HTMLInputElement).value = "" }}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-muted-foreground hover:text-foreground"
                  onClick={() => triggerImagePick(idx)}
                >
                  <ImagePlus className="h-4 w-4" />
                  插入圖片
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── PDF Preview Dialog ───────────────────────────────────── */}
      <Dialog open={pdfDialogOpen} onOpenChange={setPdfDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>預覽 PDF</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            點擊下方「列印」後，在系統列印對話框中選擇目的地為
            <span className="font-medium text-foreground"> 「儲存為 PDF」</span>
            即可匯出 PDF 檔案。
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPdfDialogOpen(false)}>
              取消
            </Button>
            <Button
              onClick={() => {
                setPdfDialogOpen(false)
                // Small delay so dialog closes before print dialog opens
                setTimeout(handlePrint, 150)
              }}
              className="gap-1.5"
            >
              <Printer className="h-4 w-4" />
              列印 / 儲存 PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
