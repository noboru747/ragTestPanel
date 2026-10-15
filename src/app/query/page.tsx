"use client"

export const runtime = 'edge'

import { useState, useRef, useEffect, useCallback } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { MessageSquareText, Send, Sparkles, ChevronDown, ShieldCheck, Eye, EyeOff } from "lucide-react"
import { BackendErrorBanner } from "@/components/backend-error-banner"
import { MaskedText } from "@/components/masked-answer"
import { fetchJson } from "@/lib/backend-fetch"
import { InlineSpinner } from "@/components/loading"
import { WaitingBubble } from "@/components/loading/waiting-bubble"
import { countRestored, splitMaskedText, type MaskMapping } from "@/lib/mask"
import { QuerySources, type QuerySource } from "@/components/query-sources"

type Message = {
  id: string
  role: "user" | "assistant"
  content: string
  sources?: QuerySource[]
  /** 送出當下的查詢範圍（避免切換專案後舊訊息的 badge 跟著變） */
  projectId?: string
  projectName?: string
  /** 後端回傳的遮罩對照（answer 中的代號 → 原值） */
  mappings?: MaskMapping[]
  /** 問題中送出前被遮罩的項數 */
  questionMasked?: number
  /** 錯誤回應（以錯誤樣式顯示） */
  isError?: boolean
}

function parseMappings(raw: unknown): MaskMapping[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (m): m is MaskMapping =>
      !!m &&
      typeof m === "object" &&
      typeof (m as MaskMapping).placeholder === "string" &&
      typeof (m as MaskMapping).original === "string"
  )
}

type Project = { id: string; name: string }
type DocItem = { id: number; name: string; type: string }

// 根據文件名關鍵字對應建議問題
const KEYWORD_Q: [RegExp, string][] = [
  [/合約|契約/, "合約的主要條款與付款方式為何？"],
  [/公文|函文|函/, "相關公文的主旨與決議是什麼？"],
  [/移交|交接/, "移交項目清單與時程安排為何？"],
  [/網路|設備|硬體/, "設備規格與維護責任範圍是什麼？"],
  [/人員|派駐|駐點/, "派駐人員的資格條件與工作職責為何？"],
  [/採購|標案|投標/, "採購規格與廠商資格要求有哪些？"],
  [/會議|紀錄|記錄/, "會議決議中的重要待辦事項有哪些？"],
  [/報告|進度/, "近期的執行進度與問題處理狀況為何？"],
  [/驗收/, "驗收標準與測試項目有哪些？"],
  [/報價|金額|費用/, "服務費用的計算方式與報價明細為何？"],
  [/規格|需求/, "系統或服務的詳細規格需求有哪些？"],
  [/保固|維護/, "保固期限與維護服務的範圍為何？"],
]

const FALLBACK_SUGGESTIONS = [
  "這個案子的服務期間與合約金額為何？",
  "主要的交付文件有哪些？",
  "派駐人員的工作項目與職責為何？",
  "有哪些重要的公文往來紀錄？",
]

function buildSuggestions(docs: DocItem[]): string[] {
  const names = docs.map((d) => d.name).join(" ")
  const seen = new Set<string>()
  const results: string[] = []

  for (const [pattern, question] of KEYWORD_Q) {
    if (pattern.test(names) && !seen.has(question)) {
      seen.add(question)
      results.push(question)
      if (results.length >= 4) break
    }
  }

  // 補到 4 條
  for (const q of FALLBACK_SUGGESTIONS) {
    if (results.length >= 4) break
    if (!seen.has(q)) results.push(q)
  }

  return results.slice(0, 4)
}

export default function QueryPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [projectId, setProjectId] = useState<string>("")
  const [projects, setProjects] = useState<Project[]>([])
  const [projectsError, setProjectsError] = useState<string | null>(null)
  const [projectsLoading, setProjectsLoading] = useState(true)
  const [suggestions, setSuggestions] = useState<string[]>(FALLBACK_SUGGESTIONS)
  /** 每則回答「顯示代號」的切換（預設顯示原值） */
  const [showCodes, setShowCodes] = useState<Record<string, boolean>>({})
  const bottomRef = useRef<HTMLDivElement>(null)
  const projectIdRef = useRef(projectId)
  projectIdRef.current = projectId

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // 選了專案後，取前 30 份文件動態產生建議問題
  const refreshSuggestions = useCallback(async (pid: string) => {
    if (!pid) {
      setSuggestions(FALLBACK_SUGGESTIONS)
      return
    }
    try {
      const res = await fetch(`/api/documents?project_id=${pid}&limit=30`)
      const data = await res.json()
      const docs: DocItem[] = data.documents ?? []
      setSuggestions(docs.length ? buildSuggestions(docs) : FALLBACK_SUGGESTIONS)
    } catch {
      setSuggestions(FALLBACK_SUGGESTIONS)
    }
  }, [])

  const handleProjectChange = useCallback(
    (pid: string) => {
      setProjectId(pid)
      refreshSuggestions(pid)
    },
    [refreshSuggestions]
  )

  // 載入專案清單；網址帶 ?projectId= 時優先選它，否則只有 1 個專案時自動選取
  const loadProjects = useCallback(async () => {
    setProjectsError(null)
    setProjectsLoading(true)
    const { data, error } = await fetchJson<{ projects?: Project[] }>("/api/projects")
    setProjectsLoading(false)
    if (error) {
      setProjects([])
      setProjectsError(error)
      return
    }
    const list = data?.projects ?? []
    setProjects(list)

    const urlPid = new URLSearchParams(window.location.search).get("projectId")
    if (projectIdRef.current) return // 已有選取，不覆蓋
    const pick =
      urlPid && list.some((p) => p.id === urlPid)
        ? urlPid
        : list.length === 1
          ? list[0].id
          : ""
    if (pick) handleProjectChange(pick)
  }, [handleProjectChange])

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  const send = async (text?: string) => {
    const question = text ?? input.trim()
    if (!question || loading) return
    if (!projectId) return

    setInput("")
    const askedProjectId = projectId
    const askedProjectName = projects.find((p) => p.id === projectId)?.name
    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: question,
      projectId: askedProjectId,
      projectName: askedProjectName,
    }
    setMessages((prev) => [...prev, userMsg])
    setLoading(true)

    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, projectId: projectId || null }),
      })
      const data = await res.json()

      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: data.answer ?? data.error ?? "（無回應內容）",
          isError: !res.ok,
          sources: data.sources,
          projectId: askedProjectId,
          projectName: askedProjectName,
          mappings: parseMappings(data.mappings),
          questionMasked: typeof data.question_masked === "number" ? data.question_masked : 0,
        },
      ])
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: "連線失敗，請確認後端服務正在運行。",
          isError: true,
          projectId: askedProjectId,
          projectName: askedProjectName,
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  const selectedProject = projects.find((p) => p.id === projectId)

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="p-6 pb-3 border-b flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">知識查詢</h1>
          <p className="text-muted-foreground text-sm mt-1">
            用自然語言查詢專案文件內容，透過 RAG 生成答案並標示來源
          </p>
        </div>

        {/* 專案篩選 — 動態載入 */}
        <div className="relative shrink-0">
          <label className="text-xs text-muted-foreground block mb-1">查詢範圍</label>
          <div className="relative">
            <select
              value={projectId}
              onChange={(e) => handleProjectChange(e.target.value)}
              disabled={projectsLoading}
              aria-busy={projectsLoading}
              className="appearance-none text-sm border rounded-md px-3 py-1.5 pr-8 bg-background hover:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer min-w-[180px] disabled:cursor-wait disabled:opacity-70"
            >
              <option value="" disabled>
                {projectsLoading ? "載入專案中…" : projectsError ? "無法載入專案" : "請選擇專案"}
              </option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {projectsLoading ? (
              <InlineSpinner className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" iconClassName="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            )}
          </div>
        </div>
      </div>

      {projectsError && (
        <div className="px-6 pt-3">
          <BackendErrorBanner message={projectsError} onRetry={loadProjects} />
        </div>
      )}

      {/* 訊息區 */}
      <ScrollArea className="flex-1 px-6 py-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-6 py-16">
            <div className="rounded-full bg-muted p-4">
              <MessageSquareText className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="font-medium">開始提問</p>
              <p className="text-sm text-muted-foreground mt-1">
                {selectedProject
                  ? `從「${selectedProject.name}」的知識庫中搜尋相關文件並生成答案`
                  : projectsLoading
                    ? "專案清單載入中…"
                    : "請先在右上角「查詢範圍」選擇專案，再開始提問（查詢僅限單一專案的知識庫）"}
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2 w-full max-w-lg">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  disabled={!projectId}
                  className="text-left text-sm px-4 py-2.5 rounded-lg border hover:border-primary/50 hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={msg.role === "user" ? "flex justify-end" : "flex justify-start"}
              >
                <div className={`max-w-[85%] ${msg.role === "user" ? "order-2" : ""}`}>
                  {msg.role === "user" ? (
                    <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm">
                      {msg.content}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                        <Sparkles className="h-3 w-3" />
                        AI 回答（基於知識庫文件）
                        {msg.projectName && (
                          <Badge variant="outline" className="text-[10px] py-0 h-4">
                            {msg.projectName}
                          </Badge>
                        )}
                      </div>
                      <Card className={msg.isError ? "border-destructive/40 bg-destructive/5" : undefined}>
                        <CardContent className="p-4">
                          <MaskedText
                            className="text-sm whitespace-pre-wrap"
                            content={msg.content}
                            mappings={msg.mappings}
                            showOriginal={!showCodes[msg.id]}
                          />
                        </CardContent>
                      </Card>
                      {(() => {
                        const segs = splitMaskedText(msg.content ?? "", msg.mappings)
                        const hasCodes = segs.some((sg) => sg.kind === "mask")
                        const restored = countRestored(segs)
                        const qMasked = msg.questionMasked ?? 0
                        if (!hasCodes && qMasked <= 0) return null
                        return (
                          <div className="flex flex-wrap items-start justify-between gap-2 text-[11px] text-muted-foreground">
                            <div className="space-y-0.5">
                              {hasCodes && (
                                <p className="flex items-center gap-1">
                                  <ShieldCheck className="h-3 w-3 text-amber-600 shrink-0" />
                                  標示處為本機對照還原的內容（{restored} 項），AI 平台僅接收代號
                                </p>
                              )}
                              {qMasked > 0 && (
                                <p className="flex items-center gap-1">
                                  <ShieldCheck className="h-3 w-3 text-green-600 shrink-0" />
                                  你的問題中有 {qMasked} 項敏感資料已在送出前遮罩
                                </p>
                              )}
                            </div>
                            {restored > 0 && (
                              <button
                                onClick={() =>
                                  setShowCodes((prev) => ({ ...prev, [msg.id]: !prev[msg.id] }))
                                }
                                className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 hover:bg-muted hover:text-foreground transition-colors shrink-0"
                              >
                                {showCodes[msg.id] ? (
                                  <><Eye className="h-3 w-3" />顯示原值</>
                                ) : (
                                  <><EyeOff className="h-3 w-3" />顯示代號</>
                                )}
                              </button>
                            )}
                          </div>
                        )
                      })()}
                      {msg.sources && msg.sources.length > 0 && (
                        <QuerySources
                          sources={msg.sources}
                          mappings={msg.mappings}
                          showOriginal={!showCodes[msg.id]}
                        />
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && <WaitingBubble />}
            <div ref={bottomRef} />
          </div>
        )}
      </ScrollArea>

      {/* 輸入區 */}
      <div className="p-4 border-t">
        {messages.length > 0 && (
          <div className="max-w-3xl mx-auto mb-2 flex gap-2 flex-wrap">
            {suggestions.slice(0, 2).map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                disabled={!projectId}
                className="text-xs px-3 py-1 rounded-full border hover:border-primary/50 hover:bg-muted transition-colors text-muted-foreground disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <div className="max-w-3xl mx-auto flex gap-2">
          <Textarea
            placeholder="輸入問題，例如：合約金額與服務期間是什麼？"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            className="resize-none min-h-[44px] max-h-32"
            rows={1}
          />
          <Button
            onClick={() => send()}
            disabled={!input.trim() || loading || !projectId}
            size={loading ? "default" : "icon"}
            className="shrink-0"
          >
            {loading ? (
              <InlineSpinner label="查詢中…" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
        <p className="text-[11px] text-center mt-2">
          {!projectId ? (
            <span className="text-destructive font-medium">請先選擇專案才能送出查詢</span>
          ) : (
            <span className="text-muted-foreground">Enter 送出 · Shift+Enter 換行 · 答案由 RAG 語意搜尋相關文件後生成</span>
          )}
        </p>
      </div>

      {messages.length > 0 && (
        <>
          <Separator />
          <div className="px-4 py-2 flex justify-center">
            <button
              onClick={() => { setMessages([]); setShowCodes({}) }}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              清除對話記錄
            </button>
          </div>
        </>
      )}
    </div>
  )
}
