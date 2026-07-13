"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import ProposalDocument, {
  type ProposalData,
  type InsertedImage,
} from "@/components/proposal/ProposalDocument"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Loader2, Sparkles } from "lucide-react"
import { printProposalPdf, downloadProposalPdf } from "@/lib/generatePdf"

/* ─── types ────────────────────────────────────────────────────── */

type Template = {
  id: string
  name: string
  type: string
  description: string
  fields: string[]
}

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
  images?: InsertedImage[]
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
  const [template, setTemplate] = useState<Template | null>(null)

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
  const [savedIndicator, setSavedIndicator] = useState(false)

  /* page settings */
  const [pageNumPos, setPageNumPos] = useState<'left' | 'center' | 'right' | 'none'>('center')
  const [showBlankAfterToc, setShowBlankAfterToc] = useState(false)

  /* section edit modal */
  const [editingSection, setEditingSection] = useState<string | null>(null)
  const [sectionDraft, setSectionDraft] = useState<ProposalData | null>(null)

  const handleSectionEdit = (sectionId: string) => {
    if (!proposalData) return
    setSectionDraft(JSON.parse(JSON.stringify(proposalData)))
    setEditingSection(sectionId)
  }

  const handlePageBreakToggle = (slotId: string) => {
    setProposalData(prev => {
      if (!prev) return prev
      const current = prev.pageBreaks ?? []
      const next = current.includes(slotId)
        ? current.filter(id => id !== slotId)
        : [...current, slotId]
      return { ...prev, pageBreaks: next }
    })
  }

  const handleEditConfirm = () => {
    if (sectionDraft) setProposalData(sectionDraft)
    setEditingSection(null)
    setSectionDraft(null)
  }

  const handleEditCancel = () => {
    setEditingSection(null)
    setSectionDraft(null)
  }

  const previewRef = useRef<HTMLDivElement>(null)
  const autoFilledFields = useRef<Set<string>>(new Set())
  const sessionDraftId = useRef<string>(String(Date.now()))

  /* ── resolve params → find template ──────────────────────────── */
  useEffect(() => {
    params.then(({ templateId }) => {
      fetch(`/api/templates/${templateId}`)
        .then(r => r.ok ? r.json() : null)
        .then((found: Template | null) => {
          setTemplate(found)
          if (found) {
            const init: Record<string, string> = {}
            found.fields.forEach((f: string) => { init[f] = "" })
            setForm(init)
          }
        })
        .catch(() => {})
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

  /* ── debounce 自動存草稿（覆蓋同一筆，不含 base64 圖片）─────── */
  useEffect(() => {
    if (!proposalData) return
    const timer = setTimeout(() => {
      const draft: DraftEntry = {
        id: sessionDraftId.current,
        label: (form["案號"] || form["機關名稱"] || "草稿") + "（自動）",
        savedAt: new Date().toISOString(),
        form,
        proposalData,
      }
      try {
        const existing: DraftEntry[] = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]")
        const filtered = existing.filter(d => d.id !== sessionDraftId.current)
        const next = [draft, ...filtered].slice(0, 20)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
        setDrafts(next)
        setSavedIndicator(true)
        setTimeout(() => setSavedIndicator(false), 2000)
      } catch {}
    }, 2000)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, proposalData])

  /* ── 載入常駐變數並自動填入（全域，template 就緒後只填空欄位）*/
  useEffect(() => {
    if (!template) return
    fetch("/api/company-vars")
      .then(r => r.json())
      .then(({ vars }: { vars: Array<{ key: string; value: string }> }) => {
        if (!vars?.length) return
        setForm(prev => {
          const patch: Record<string, string> = {}
          for (const { key, value } of vars) {
            if (key in prev && !prev[key]) {
              patch[key] = value
              autoFilledFields.current.add(key)
            }
          }
          return Object.keys(patch).length ? { ...prev, ...patch } : prev
        })
      })
      .catch(() => {})
  }, [template])

  /* ── 專案變數填入（選擇專案改變時，填空欄位 + 被自動填入的欄位）*/
  useEffect(() => {
    if (!projectId || !template) return
    fetch(`/api/company-vars/project/${projectId}`)
      .then(r => r.json())
      .then(({ vars }: { vars: Array<{ key: string; value: string }> }) => {
        if (!vars?.length) return
        setForm(prev => {
          const patch: Record<string, string> = {}
          for (const { key, value } of vars) {
            if (key in prev) {
              if (!prev[key] || autoFilledFields.current.has(key)) {
                patch[key] = value
                autoFilledFields.current.add(key)
              }
            }
          }
          return Object.keys(patch).length ? { ...prev, ...patch } : prev
        })
      })
      .catch(() => {})
  }, [projectId, template])

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
  const handlePreviewPDF = async () => {
    if (!proposalData || pdfLoading !== null) return
    setPdfLoading("preview")
    try {
      await printProposalPdf(proposalData, images)
    } catch {
      alert("PDF 產生失敗，請稍後再試")
    } finally {
      setPdfLoading(null)
    }
  }
  const handleDownloadPDF = async () => {
    if (!proposalData || pdfLoading !== null) return
    setPdfLoading("download")
    try {
      await downloadProposalPdf(proposalData, images)
    } catch {
      alert("PDF 產生失敗，請稍後再試")
    } finally {
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
                    setImages(d.images ?? [])
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
                          onChange={(e) => {
                            const v = e.target.value
                            setForm((prev) => ({ ...prev, [field]: v }))
                            autoFilledFields.current.delete(field)
                          }}
                          rows={3}
                          placeholder={field}
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      ) : (
                        <input
                          type="text"
                          value={form[field] ?? ""}
                          onChange={(e) => {
                            const v = e.target.value
                            setForm((prev) => ({ ...prev, [field]: v }))
                            autoFilledFields.current.delete(field)
                          }}
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

  /* ── section labels for modal header ─────────────────────────── */
  const SECTION_LABELS: Record<string, string> = {
    cover:     "封面資訊",
    summary:   "建議書摘要表",
    scope:     "履約標的",
    objectives:"需求目標",
    workItems: "工作要項",
    hrPlan:    "人力配置說明",
    quality:   "品質保證管理",
    company:   "公司基本資料",
    pricing:   "價格分析",
  }

  /* ── section edit modal ───────────────────────────────────────── */
  const ta = (
    value: string,
    onChange: (v: string) => void,
    rows = 3,
  ) => (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      rows={rows}
      className="w-full rounded border border-gray-200 px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-amber-400"
    />
  )

  const inp = (value: string, onChange: (v: string) => void, placeholder = "") => (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full h-9 rounded border border-gray-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
    />
  )

  const label = (text: string) => (
    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{text}</label>
  )

  const SectionModal = editingSection && sectionDraft ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col">
        {/* header */}
        <div className="px-6 py-4 border-b flex items-center justify-between shrink-0">
          <h3 className="font-semibold text-gray-800">
            <span className="text-amber-500 mr-2">✏</span>
            {SECTION_LABELS[editingSection] ?? editingSection}
          </h3>
          <button onClick={handleEditCancel} className="text-gray-400 hover:text-gray-700 text-xl leading-none">&times;</button>
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {editingSection === "cover" && (
            <>
              <div>{label("機關名稱")}{inp(sectionDraft.courtName, v => setSectionDraft(d => d ? { ...d, courtName: v } : d))}</div>
              <div>{label("標案名稱")}{inp(sectionDraft.caseTitle, v => setSectionDraft(d => d ? { ...d, caseTitle: v } : d))}</div>
              <div className="grid grid-cols-2 gap-4">
                <div>{label("案號")}{inp(sectionDraft.caseCode, v => setSectionDraft(d => d ? { ...d, caseCode: v } : d))}</div>
                <div>{label("提交日期")}{inp(sectionDraft.submissionDate, v => { autoFilledFields.current.delete('submissionDate'); setSectionDraft(d => d ? { ...d, submissionDate: v } : d) })}</div>
              </div>
              <div>{label("投標公司")}{inp(sectionDraft.companyName, v => { autoFilledFields.current.delete('companyName'); setSectionDraft(d => d ? { ...d, companyName: v } : d) })}</div>
              <div>{label("地址")}{inp(sectionDraft.companyAddress, v => { autoFilledFields.current.delete('companyAddress'); setSectionDraft(d => d ? { ...d, companyAddress: v } : d) })}</div>
              <div className="grid grid-cols-2 gap-4">
                <div>{label("聯絡人")}{inp(sectionDraft.contactPerson, v => { autoFilledFields.current.delete('contactPerson'); setSectionDraft(d => d ? { ...d, contactPerson: v } : d) })}</div>
                <div>{label("電話")}{inp(sectionDraft.contactPhone, v => { autoFilledFields.current.delete('contactPhone'); setSectionDraft(d => d ? { ...d, contactPhone: v } : d) })}</div>
              </div>
            </>
          )}

          {editingSection === "summary" && sectionDraft.summary.map((s, i) => (
            <div key={i}>
              {label(s.category)}
              {ta(s.content, v => setSectionDraft(d => {
                if (!d) return d
                const summary = [...d.summary]
                summary[i] = { ...summary[i], content: v }
                return { ...d, summary }
              }), 3)}
            </div>
          ))}

          {editingSection === "scope" && (
            <div>{label("履約標的說明")}{ta(sectionDraft.projectOverview.scope, v => setSectionDraft(d => d ? { ...d, projectOverview: { ...d.projectOverview, scope: v } } : d), 5)}</div>
          )}

          {editingSection === "objectives" && (
            <div className="space-y-2">
              {label("需求目標（每行一項）")}
              {sectionDraft.projectOverview.objectives.map((obj, i) => (
                <div key={i} className="flex gap-2">
                  {inp(obj, v => setSectionDraft(d => {
                    if (!d) return d
                    const objectives = [...d.projectOverview.objectives]
                    objectives[i] = v
                    return { ...d, projectOverview: { ...d.projectOverview, objectives } }
                  }))}
                  <button
                    onClick={() => setSectionDraft(d => {
                      if (!d) return d
                      const objectives = d.projectOverview.objectives.filter((_, j) => j !== i)
                      return { ...d, projectOverview: { ...d.projectOverview, objectives } }
                    })}
                    className="text-xs text-red-400 hover:text-red-600 px-2 border border-red-200 rounded shrink-0"
                  >刪</button>
                </div>
              ))}
              <button
                onClick={() => setSectionDraft(d => {
                  if (!d) return d
                  const objectives = [...d.projectOverview.objectives, ""]
                  return { ...d, projectOverview: { ...d.projectOverview, objectives } }
                })}
                className="text-xs text-amber-600 border border-amber-300 rounded px-3 py-1 hover:bg-amber-50"
              >+ 新增目標</button>
            </div>
          )}

          {editingSection === "workItems" && (
            <div className="space-y-4">
              {sectionDraft.projectOverview.workItems.map((item, i) => (
                <div key={i} className="border border-gray-200 rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-500">工作要項 {['一','二','三','四','五','六','七','八'][i]}</span>
                    <button
                      onClick={() => setSectionDraft(d => {
                        if (!d) return d
                        const workItems = d.projectOverview.workItems.filter((_, j) => j !== i)
                        return { ...d, projectOverview: { ...d.projectOverview, workItems } }
                      })}
                      className="text-xs text-red-400 hover:text-red-600"
                    >移除</button>
                  </div>
                  <div>{label("標題")}{inp(item.title, v => setSectionDraft(d => {
                    if (!d) return d
                    const workItems = [...d.projectOverview.workItems]
                    workItems[i] = { ...workItems[i], title: v }
                    return { ...d, projectOverview: { ...d.projectOverview, workItems } }
                  }))}</div>
                  <div>{label("說明")}{ta(item.content, v => setSectionDraft(d => {
                    if (!d) return d
                    const workItems = [...d.projectOverview.workItems]
                    workItems[i] = { ...workItems[i], content: v }
                    return { ...d, projectOverview: { ...d.projectOverview, workItems } }
                  }), 3)}</div>
                </div>
              ))}
              <button
                onClick={() => setSectionDraft(d => {
                  if (!d) return d
                  const workItems = [...d.projectOverview.workItems, { title: "", content: "" }]
                  return { ...d, projectOverview: { ...d.projectOverview, workItems } }
                })}
                className="text-xs text-amber-600 border border-amber-300 rounded px-3 py-1 hover:bg-amber-50"
              >+ 新增工作要項</button>
            </div>
          )}

          {editingSection === "hrPlan" && (
            <div>{label("人力配置說明")}{ta(sectionDraft.hrPlan.teamStructure, v => setSectionDraft(d => d ? { ...d, hrPlan: { ...d.hrPlan, teamStructure: v } } : d), 6)}</div>
          )}

          {editingSection === "quality" && (
            <div>{label("品質保證管理說明")}{ta(sectionDraft.hrPlan.qualityManagement, v => setSectionDraft(d => d ? { ...d, hrPlan: { ...d.hrPlan, qualityManagement: v } } : d), 6)}</div>
          )}

          {editingSection === "company" && (
            <>
              <div className="grid grid-cols-3 gap-4">
                <div>{label("成立時間")}{inp(sectionDraft.companyProfile.established, v => setSectionDraft(d => d ? { ...d, companyProfile: { ...d.companyProfile, established: v } } : d))}</div>
                <div>{label("資本額")}{inp(sectionDraft.companyProfile.capital, v => setSectionDraft(d => d ? { ...d, companyProfile: { ...d.companyProfile, capital: v } } : d))}</div>
                <div>{label("員工人數")}{inp(sectionDraft.companyProfile.employees, v => setSectionDraft(d => d ? { ...d, companyProfile: { ...d.companyProfile, employees: v } } : d))}</div>
              </div>
              <div>{label("公司介紹")}{ta(sectionDraft.companyProfile.introduction, v => setSectionDraft(d => d ? { ...d, companyProfile: { ...d.companyProfile, introduction: v } } : d), 4)}</div>
              <div className="space-y-3">
                {label("履約實績")}
                {sectionDraft.companyProfile.experiences.map((exp, i) => (
                  <div key={i} className="border border-gray-200 rounded-lg p-3 grid grid-cols-2 gap-3">
                    <div>{label("機關/客戶")}{inp(exp.client, v => setSectionDraft(d => {
                      if (!d) return d
                      const experiences = [...d.companyProfile.experiences]
                      experiences[i] = { ...experiences[i], client: v }
                      return { ...d, companyProfile: { ...d.companyProfile, experiences } }
                    }))}</div>
                    <div>{label("專案名稱")}{inp(exp.project, v => setSectionDraft(d => {
                      if (!d) return d
                      const experiences = [...d.companyProfile.experiences]
                      experiences[i] = { ...experiences[i], project: v }
                      return { ...d, companyProfile: { ...d.companyProfile, experiences } }
                    }))}</div>
                    <div>{label("執行期間")}{inp(exp.period, v => setSectionDraft(d => {
                      if (!d) return d
                      const experiences = [...d.companyProfile.experiences]
                      experiences[i] = { ...experiences[i], period: v }
                      return { ...d, companyProfile: { ...d.companyProfile, experiences } }
                    }))}</div>
                    <div className="flex gap-2 items-end">
                      <div className="flex-1">{label("合約金額")}{inp(exp.amount, v => setSectionDraft(d => {
                        if (!d) return d
                        const experiences = [...d.companyProfile.experiences]
                        experiences[i] = { ...experiences[i], amount: v }
                        return { ...d, companyProfile: { ...d.companyProfile, experiences } }
                      }))}</div>
                      <button
                        onClick={() => setSectionDraft(d => {
                          if (!d) return d
                          const experiences = d.companyProfile.experiences.filter((_, j) => j !== i)
                          return { ...d, companyProfile: { ...d.companyProfile, experiences } }
                        })}
                        className="text-xs text-red-400 hover:text-red-600 h-9 px-2 border border-red-200 rounded shrink-0"
                      >刪</button>
                    </div>
                  </div>
                ))}
                <button
                  onClick={() => setSectionDraft(d => {
                    if (!d) return d
                    const experiences = [...d.companyProfile.experiences, { client: "", project: "", period: "", amount: "" }]
                    return { ...d, companyProfile: { ...d.companyProfile, experiences } }
                  })}
                  className="text-xs text-amber-600 border border-amber-300 rounded px-3 py-1 hover:bg-amber-50"
                >+ 新增實績</button>
              </div>
            </>
          )}

          {editingSection === "pricing" && (
            <>
              <div>{label("計費說明")}{ta(sectionDraft.pricing.basis, v => setSectionDraft(d => d ? { ...d, pricing: { ...d.pricing, basis: v } } : d), 3)}</div>
              <div className="space-y-3">
                {label("報價明細")}
                {sectionDraft.pricing.items.map((item, i) => (
                  <div key={i} className="border border-gray-200 rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-gray-500">第 {i + 1} 項</span>
                      <button
                        onClick={() => setSectionDraft(d => {
                          if (!d) return d
                          const items = d.pricing.items.filter((_, j) => j !== i)
                          return { ...d, pricing: { ...d.pricing, items } }
                        })}
                        className="text-xs text-red-400 hover:text-red-600"
                      >移除</button>
                    </div>
                    <div>{label("項目名稱")}{inp(item.item, v => setSectionDraft(d => {
                      if (!d) return d
                      const items = [...d.pricing.items]
                      items[i] = { ...items[i], item: v }
                      return { ...d, pricing: { ...d.pricing, items } }
                    }))}</div>
                    <div className="grid grid-cols-4 gap-2">
                      <div>{label("單位")}{inp(item.unit, v => setSectionDraft(d => {
                        if (!d) return d
                        const items = [...d.pricing.items]
                        items[i] = { ...items[i], unit: v }
                        return { ...d, pricing: { ...d.pricing, items } }
                      }))}</div>
                      <div>{label("數量")}{inp(String(item.quantity), v => setSectionDraft(d => {
                        if (!d) return d
                        const items = [...d.pricing.items]
                        items[i] = { ...items[i], quantity: Number(v) || 0 }
                        return { ...d, pricing: { ...d.pricing, items } }
                      }))}</div>
                      <div>{label("單價")}{inp(item.unitPrice, v => setSectionDraft(d => {
                        if (!d) return d
                        const items = [...d.pricing.items]
                        items[i] = { ...items[i], unitPrice: v }
                        return { ...d, pricing: { ...d.pricing, items } }
                      }))}</div>
                      <div>{label("小計")}{inp(item.subtotal, v => setSectionDraft(d => {
                        if (!d) return d
                        const items = [...d.pricing.items]
                        items[i] = { ...items[i], subtotal: v }
                        return { ...d, pricing: { ...d.pricing, items } }
                      }))}</div>
                    </div>
                  </div>
                ))}
                <button
                  onClick={() => setSectionDraft(d => {
                    if (!d) return d
                    const items = [...d.pricing.items, { item: "", unit: "式", quantity: 1, unitPrice: "NT$0", subtotal: "NT$0" }]
                    return { ...d, pricing: { ...d.pricing, items } }
                  })}
                  className="text-xs text-amber-600 border border-amber-300 rounded px-3 py-1 hover:bg-amber-50"
                >+ 新增項目</button>
              </div>
              <div>{label("總報價金額")}{inp(sectionDraft.pricing.totalAmount, v => setSectionDraft(d => d ? { ...d, pricing: { ...d.pricing, totalAmount: v } } : d), "NT$0")}</div>
            </>
          )}

        </div>

        {/* footer */}
        <div className="px-6 py-4 border-t flex justify-end gap-2 shrink-0">
          <button onClick={handleEditCancel} className="text-sm px-4 py-1.5 border border-gray-300 rounded text-gray-600 hover:bg-gray-50 transition">取消</button>
          <button onClick={handleEditConfirm} className="text-sm px-4 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded transition">確認</button>
        </div>
      </div>
    </div>
  ) : null

  /* ══════════════════════════════════════════════════════════════
     PHASE: result
  ══════════════════════════════════════════════════════════════ */
  return (
    <>
      {SectionModal}
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
                  onClick={() => {
                    if (!proposalData) return
                    const draft: DraftEntry = {
                      id: sessionDraftId.current,
                      label: (form["案號"] || form["機關名稱"] || "草稿") + "（含圖）",
                      savedAt: new Date().toISOString(),
                      form,
                      proposalData,
                      images,
                    }
                    try {
                      const existing: DraftEntry[] = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]")
                      const filtered = existing.filter(d => d.id !== sessionDraftId.current)
                      const next = [draft, ...filtered].slice(0, 20)
                      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
                      setDrafts(next)
                      setSavedIndicator(true)
                      setTimeout(() => setSavedIndicator(false), 2000)
                    } catch {}
                  }}
                  className={`text-sm px-3 py-1.5 rounded-md border transition-colors ${
                    savedIndicator
                      ? "border-green-500 bg-green-500 text-white"
                      : "border-green-400 bg-green-50 text-green-700 hover:bg-green-100"
                  }`}
                >
                  {savedIndicator ? "已儲存 ✓" : "更新草稿"}
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
              </div>
            </div>

            {editMode && (
              <div className="px-6 py-3 bg-blue-50 border-b text-sm text-blue-700">
                圖片插入模式：捲動至各章節，點擊「+ 插入圖片」即可上傳。
              </div>
            )}

            {/* ── 分頁設定列 ─────────────────────────────────────────────── */}
            <div className="px-6 py-2.5 bg-gray-50 border-b flex flex-wrap items-center gap-5 text-xs text-gray-600">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-500">頁碼位置</span>
                {([ ['left','靠左'], ['center','置中'], ['right','靠右'], ['none','無'] ] as const).map(([pos, label]) => (
                  <button
                    key={pos}
                    onClick={() => setPageNumPos(pos)}
                    className={`px-2.5 py-1 rounded border transition ${
                      pageNumPos === pos
                        ? 'bg-gray-800 text-white border-gray-800'
                        : 'border-gray-300 hover:bg-gray-100 text-gray-600'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showBlankAfterToc}
                  onChange={e => setShowBlankAfterToc(e.target.checked)}
                  className="rounded"
                />
                <span>目錄後插入空白頁</span>
              </label>
            </div>

            <div id="proposal-pdf-target" className="p-6">
              <ProposalDocument
                data={proposalData}
                images={images}
                editMode={editMode}
                onImageInsert={handleImageInsert}
                onImageRemove={handleImageRemove}
                onImageUpdate={handleImageUpdate}
                onSectionEdit={handleSectionEdit}
                onPageBreakToggle={handlePageBreakToggle}
                pageNumPos={pageNumPos}
                showBlankAfterToc={showBlankAfterToc}
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
