"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { BUILT_TEMPLATES } from "@/lib/built-templates"
import ProposalDocument, {
  type ProposalData,
  type InsertedImage,
} from "@/components/proposal/ProposalDocument"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Loader2, Sparkles } from "lucide-react"

/* ─── types ────────────────────────────────────────────────────── */

type Project = {
  id: string
  name: string
}

type Phase = "form" | "loading" | "result"

type DraftEntry = {
  id: string
  label: string
  savedAt: string
  form: Record<string, string>
  proposalData: ProposalData
}

const STORAGE_KEY = "rga-km-proposal-drafts"

/* ─── page ─────────────────────────────────────────────────────── */

export default function GenerateFromTemplatePage({
  params,
}: {
  params: Promise<{ templateId: string }>
}) {
  const router = useRouter()

  /* template */
  const [template, setTemplate] = useState<(typeof BUILT_TEMPLATES)[0] | null>(null)

  /* projects */
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState("")

  /* form */
  const [form, setForm] = useState<Record<string, string>>({})

  /* phase & result */
  const [phase, setPhase] = useState<Phase>("form")
  const [proposalData, setProposalData] = useState<ProposalData | null>(null)
  const [plainContent, setPlainContent] = useState<string>("")

  /* image / edit mode */
  const [images, setImages] = useState<InsertedImage[]>([])
  const [editMode, setEditMode] = useState(false)

  /* error & pdf loading */
  const [error, setError] = useState<string | null>(null)
  const [pdfLoading, setPdfLoading] = useState<"preview" | "download" | null>(null)

  /* drafts panel */
  const [drafts, setDrafts] = useState<DraftEntry[]>([])
  const [panelOpen, setPanelOpen] = useState(false)

  const previewRef = useRef<HTMLDivElement>(null)

  /* ── resolve params → find template ──────────────────────────── */
  useEffect(() => {
    params.then(({ templateId }) => {
      const found = BUILT_TEMPLATES.find((t) => t.id === templateId) ?? null
      setTemplate(found)
      if (found) {
        const init: Record<string, string> = {}
        found.fields.forEach((f) => { init[f] = "" })
        setForm(init)
      }
    })
  }, [params])

  /* ── load projects ────────────────────────────────────────────── */
  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => {
        const list: Project[] = d.projects ?? []
        setProjects(list)
        if (list.length > 0) setProjectId(list[0].id)
      })
      .catch(() => {})
  }, [])

  /* ── load drafts from localStorage on mount ───────────────────── */
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]")
      setDrafts(stored)
    } catch {}
  }, [])

  /* ── generate ─────────────────────────────────────────────────── */
  const handleGenerate = async () => {
    if (!projectId) { setError("請先選擇專案"); return }
    setPhase("loading")
    setError(null)

    const res = await fetch("/api/generate/from-template", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        template_id: template!.id,
        project_id: projectId,
        fields: form,
      }),
    })

    const data = await res.json()

    if (data.proposal_data) {
      setProposalData(data.proposal_data)
      setPlainContent("")

      // 自動儲存草稿
      const draft: DraftEntry = {
        id: String(Date.now()),
        label: form["案號"] || form["機關名稱"] || "草稿",
        savedAt: new Date().toISOString(),
        form,
        proposalData: data.proposal_data,
      }
      try {
        const existing: DraftEntry[] = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]")
        const next = [draft, ...existing].slice(0, 20)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
        setDrafts(next)
      } catch {}
    } else {
      setPlainContent(data.content ?? "")
      setProposalData(null)
    }

    setPhase("result")
    setTimeout(() => previewRef.current?.scrollIntoView({ behavior: "smooth" }), 100)
  }

  /* ── PDF helpers ──────────────────────────────────────────────── */
  const getPdfOptions = () => ({
    margin: [20, 25, 20, 25],
    image: { type: "jpeg" as const, quality: 0.97 },
    html2canvas: { scale: 2, useCORS: true, logging: false },
    jsPDF: { unit: "mm" as const, format: "a4" as const, orientation: "portrait" as const },
  })

  const handlePreviewPDF = async () => {
    const el = document.getElementById("proposal-pdf-target")
    if (!el) return
    setPdfLoading("preview")
    const wasEditing = editMode
    if (wasEditing) setEditMode(false)
    await new Promise((r) => setTimeout(r, 50))
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const html2pdf = ((await import("html2pdf.js")) as any).default
      const blob: Blob = await html2pdf().set(getPdfOptions()).from(el).outputPdf("blob")
      const url = URL.createObjectURL(blob)
      window.open(url, "_blank")
    } catch {
      // html2canvas 不支援 oklch/lab CSS 色彩函數，fallback 到列印
      window.print()
    } finally {
      if (wasEditing) setEditMode(true)
      setPdfLoading(null)
    }
  }

  const handleDownloadPDF = async () => {
    const el = document.getElementById("proposal-pdf-target")
    if (!el) return
    setPdfLoading("download")
    const wasEditing = editMode
    if (wasEditing) setEditMode(false)
    await new Promise((r) => setTimeout(r, 50))
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const html2pdf = ((await import("html2pdf.js")) as any).default
      const filename = `建議書_${form["案號"] || "draft"}_${new Date().toLocaleDateString("zh-TW").replace(/\//g, "")}.pdf`
      await html2pdf().set({ ...getPdfOptions(), filename }).from(el).save()
    } catch {
      window.print()
    } finally {
      if (wasEditing) setEditMode(true)
      setPdfLoading(null)
    }
  }

  /* ── image handlers ───────────────────────────────────────────── */
  const handleImageInsert = (slotId: string, file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const src = e.target?.result as string
      setImages((prev) => [...prev, { id: slotId, src, width: "100%", align: "center" }])
    }
    reader.readAsDataURL(file)
  }

  const handleImageRemove = (slotId: string, idx: number) => {
    setImages((prev) => {
      const slotIndices = prev.reduce<number[]>((acc, img, i) => {
        if (img.id === slotId) acc.push(i)
        return acc
      }, [])
      const target = slotIndices[idx]
      if (target === undefined) return prev
      return prev.filter((_, i) => i !== target)
    })
  }

  const handleImageUpdate = (slotId: string, idx: number, updates: Partial<InsertedImage>) => {
    setImages((prev) => {
      const result = [...prev]
      const slotIndices = prev.reduce<number[]>((acc, img, i) => {
        if (img.id === slotId) acc.push(i)
        return acc
      }, [])
      const target = slotIndices[idx]
      if (target !== undefined) result[target] = { ...result[target], ...updates }
      return result
    })
  }

  /* ── loading state ────────────────────────────────────────────── */
  if (!template) {
    return (
      <div className="p-8 flex items-center gap-3 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        載入模板中...
      </div>
    )
  }

  /* ── drafts panel (shared across all phases) ──────────────────── */
  const DraftsPanel = (
    <>
      {/* toggle 按鈕 */}
      <button
        onClick={() => setPanelOpen((v) => !v)}
        className="fixed top-1/2 right-0 -translate-y-1/2 z-50 bg-gray-800 text-white text-xs px-1.5 py-4 rounded-l-lg shadow-lg hover:bg-gray-700 transition"
        style={{ writingMode: "vertical-rl" }}
      >
        {panelOpen ? "▶ 收起" : "◀ 草稿"}
      </button>

      {/* 右側草稿面板 */}
      {panelOpen && (
        <div className="fixed top-0 right-0 h-full w-72 bg-white border-l border-gray-200 shadow-xl z-40 flex flex-col">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <h3 className="font-semibold text-gray-800 text-sm">已儲存草稿</h3>
            <span className="text-xs text-gray-400">{drafts.length} 份</span>
          </div>

          <div className="flex-1 overflow-y-auto">
            {drafts.length === 0 ? (
              <p className="text-xs text-gray-400 text-center mt-8">尚無已儲存草稿</p>
            ) : (
              drafts.map((d) => (
                <div
                  key={d.id}
                  className="px-4 py-3 border-b hover:bg-gray-50 cursor-pointer group"
                  onClick={() => {
                    setProposalData(d.proposalData)
                    setForm(d.form)
                    setImages([])
                    setPhase("result")
                    setPanelOpen(false)
                    setTimeout(() => previewRef.current?.scrollIntoView({ behavior: "smooth" }), 100)
                  }}
                >
                  <p className="text-sm font-medium text-gray-800 truncate">{d.label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {new Date(d.savedAt).toLocaleString("zh-TW", {
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                  <div className="mt-1 flex gap-2 opacity-0 group-hover:opacity-100 transition">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        const next = drafts.filter((x) => x.id !== d.id)
                        setDrafts(next)
                        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
                      }}
                      className="text-xs text-red-400 hover:text-red-600"
                    >
                      刪除
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="px-4 py-3 border-t">
            <button
              onClick={() => {
                if (!confirm("確定清除所有草稿？")) return
                setDrafts([])
                localStorage.removeItem(STORAGE_KEY)
              }}
              className="text-xs text-gray-400 hover:text-red-500 transition"
            >
              清除所有草稿
            </button>
          </div>
        </div>
      )}
    </>
  )

  /* ══════════════════════════════════════════════════════════════
     PHASE: form
  ══════════════════════════════════════════════════════════════ */
  if (phase === "form") {
    return (
      <>
        {DraftsPanel}
        <div className="p-6 max-w-2xl mx-auto space-y-6">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            返回
          </button>

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
                    <div key={field} className="space-y-1.5">
                      <label className="text-sm text-muted-foreground">{field}</label>
                      {field === "需求重點" ? (
                        <textarea
                          value={form[field] ?? ""}
                          onChange={(e) =>
                            setForm((prev) => ({ ...prev, [field]: e.target.value }))
                          }
                          rows={3}
                          placeholder={field}
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      ) : (
                        <input
                          type="text"
                          value={form[field] ?? ""}
                          onChange={(e) =>
                            setForm((prev) => ({ ...prev, [field]: e.target.value }))
                          }
                          placeholder={field}
                          className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}

              {error && <p className="text-sm text-destructive">{error}</p>}

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
      </>
    )
  }

  /* ══════════════════════════════════════════════════════════════
     PHASE: loading
  ══════════════════════════════════════════════════════════════ */
  if (phase === "loading") {
    return (
      <>
        {DraftsPanel}
        <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
          <Loader2 className="h-12 w-12 text-primary animate-spin" />
          <div className="text-center space-y-1.5">
            <p className="font-semibold">正在根據專案文件生成{template.name}，請稍候...</p>
            <p className="text-sm text-muted-foreground">AI 讀取知識庫中，預計需要 30–120 秒</p>
          </div>
        </div>
      </>
    )
  }

  /* ══════════════════════════════════════════════════════════════
     PHASE: result
  ══════════════════════════════════════════════════════════════ */
  return (
    <>
      {DraftsPanel}
      <div className="p-6 max-w-4xl mx-auto space-y-6 pb-16">
        <button
          onClick={() => {
            setPhase("form")
            setProposalData(null)
            setPlainContent("")
            setImages([])
            setEditMode(false)
          }}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          重新填寫
        </button>

        {proposalData ? (
          /* ── 建議書模板：ProposalDocument ── */
          <div ref={previewRef} className="bg-white rounded-xl shadow">
            {/* 工具列 */}
            <div className="px-6 py-4 border-b flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-gray-700">預覽 / 插入圖片</h2>
                {images.length > 0 && (
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                    已插入 {images.length} 張
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => setEditMode((v) => !v)}
                  className={`text-sm px-3 py-1.5 rounded-md border transition-colors ${
                    editMode
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {editMode ? "完成插入圖片" : "插入圖片"}
                </button>
                <button
                  onClick={handlePreviewPDF}
                  disabled={pdfLoading !== null}
                  className="text-sm px-3 py-1.5 rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  {pdfLoading === "preview" ? "產生中…" : "預覽 PDF"}
                </button>
                <button
                  onClick={handleDownloadPDF}
                  disabled={pdfLoading !== null}
                  className="text-sm px-3 py-1.5 rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  {pdfLoading === "download" ? "產生中…" : "下載 PDF"}
                </button>
                <button
                  onClick={() => window.print()}
                  className="text-sm px-3 py-1.5 rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  列印
                </button>
              </div>
            </div>

            {editMode && (
              <div className="px-6 py-3 bg-blue-50 border-b text-sm text-blue-700">
                圖片插入模式：捲動至各章節，點擊「+ 插入圖片」即可上傳。
              </div>
            )}

            <div id="proposal-pdf-target" className="p-6">
              <ProposalDocument
                data={proposalData}
                images={images}
                editMode={editMode}
                onImageInsert={handleImageInsert}
                onImageRemove={handleImageRemove}
                onImageUpdate={handleImageUpdate}
              />
            </div>
          </div>
        ) : (
          /* ── 其他模板：純文字段落 ── */
          <div ref={previewRef} className="space-y-6">
            <h1 className="text-2xl font-bold">{template.name}</h1>
            {plainContent
              .split(/\n(?=## )/)
              .map((chunk, idx) => {
                const lines = chunk.split("\n")
                const firstLine = lines[0].trimEnd()
                const title = firstLine.startsWith("## ")
                  ? firstLine.slice(3).trim()
                  : firstLine.trim()
                const body = lines.slice(1).join("\n").trim()
                if (!title) return null
                return (
                  <Card key={idx}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">{title}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <pre className="whitespace-pre-wrap text-sm font-sans leading-relaxed text-foreground/90">
                        {body}
                      </pre>
                    </CardContent>
                  </Card>
                )
              })}
          </div>
        )}
      </div>
    </>
  )
}
