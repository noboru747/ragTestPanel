export const runtime = 'edge'

"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { MessageSquareText, Send, FileText, Loader2, Sparkles, ChevronDown } from "lucide-react"

type Message = {
  id: string
  role: "user" | "assistant"
  content: string
  sources?: { docId: string; docName: string; relevance: number }[]
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
  const [suggestions, setSuggestions] = useState<string[]>(FALLBACK_SUGGESTIONS)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // 載入專案清單
  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => setProjects(d.projects ?? d ?? []))
      .catch(() => {})
  }, [])

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

  const handleProjectChange = (pid: string) => {
    setProjectId(pid)
    refreshSuggestions(pid)
  }

  const send = async (text?: string) => {
    const question = text ?? input.trim()
    if (!question || loading) return
    if (!projectId) return

    setInput("")
    const userMsg: Message = { id: Date.now().toString(), role: "user", content: question }
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
          content: data.answer,
          sources: data.sources,
        },
      ])
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: "連線失敗，請確認後端服務正在運行。",
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
            用自然語言查詢所有專案文件內容，由本地 Ollama 透過 RAG 生成答案
          </p>
        </div>

        {/* 專案篩選 — 動態載入 */}
        <div className="relative shrink-0">
          <label className="text-xs text-muted-foreground block mb-1">查詢範圍</label>
          <div className="relative">
            <select
              value={projectId}
              onChange={(e) => handleProjectChange(e.target.value)}
              className="appearance-none text-sm border rounded-md px-3 py-1.5 pr-8 bg-background hover:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer min-w-[180px]"
            >
              <option value="">全部專案</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          </div>
        </div>
      </div>

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
                  : "從所有專案的知識庫中獲取答案，並標示來源文件"}
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
                        {selectedProject && (
                          <Badge variant="outline" className="text-[10px] py-0 h-4">
                            {selectedProject.name}
                          </Badge>
                        )}
                      </div>
                      <Card>
                        <CardContent className="p-4">
                          <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
                        </CardContent>
                      </Card>
                      {msg.sources && msg.sources.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                            <FileText className="h-3 w-3" />
                            參考來源（{msg.sources.length} 份文件）
                          </p>
                          {msg.sources.map((src) => (
                            <div
                              key={src.docId}
                              className="flex items-center justify-between text-xs bg-muted rounded-md px-3 py-1.5"
                            >
                              <span className="truncate">{src.docName}</span>
                              <Badge
                                variant="outline"
                                className="text-[10px] ml-2 shrink-0"
                              >
                                {(src.relevance * 100).toFixed(0)}% 相關
                              </Badge>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <Card className="max-w-[85%]">
                  <CardContent className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    正在向量搜尋並生成答案...
                  </CardContent>
                </Card>
              </div>
            )}
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
            size="icon"
            className="shrink-0"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
        <p className="text-[11px] text-center mt-2">
          {!projectId ? (
            <span className="text-destructive font-medium">請先選擇專案才能送出查詢</span>
          ) : (
            <span className="text-muted-foreground">Enter 送出 · Shift+Enter 換行 · 答案由本地 Ollama 透過 RAG 語意搜尋生成</span>
          )}
        </p>
      </div>

      {messages.length > 0 && (
        <>
          <Separator />
          <div className="px-4 py-2 flex justify-center">
            <button
              onClick={() => setMessages([])}
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
