"use client"

import { useState } from "react"
import { X } from "lucide-react"

export type FeedbackEntry = {
  id: string
  code: string
  page: string
  topic: string
  content: string
  submittedAt: string
}

const STORAGE_KEY = "rga-km-feedback"

const PAGE_OPTIONS = [
  "儀表板",
  "知識查詢",
  "生成文件 — 填寫表單",
  "生成文件 — 預覽 PDF",
  "OCR 入庫",
  "Git 整合",
  "其他",
]

export function saveFeedback(entry: Omit<FeedbackEntry, "id" | "submittedAt">) {
  try {
    const existing: FeedbackEntry[] = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]")
    const next: FeedbackEntry[] = [
      { ...entry, id: String(Date.now()), submittedAt: new Date().toISOString() },
      ...existing,
    ].slice(0, 200)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {}
}

export function loadFeedback(): FeedbackEntry[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]")
  } catch {
    return []
  }
}

export function deleteFeedback(id: string) {
  try {
    const existing = loadFeedback().filter((f) => f.id !== id)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing))
  } catch {}
}

export function clearAllFeedback() {
  localStorage.removeItem(STORAGE_KEY)
}

type Props = {
  open: boolean
  onClose: () => void
}

export function FeedbackModal({ open, onClose }: Props) {
  const [page, setPage] = useState(PAGE_OPTIONS[0])
  const [topic, setTopic] = useState("")
  const [content, setContent] = useState("")
  const [done, setDone] = useState(false)

  if (!open) return null

  const handleSubmit = async () => {
    if (!topic.trim() || !content.trim()) return
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page, topic: topic.trim(), content: content.trim() }),
      })
    } catch {}
    setTopic("")
    setContent("")
    setDone(true)
    setTimeout(() => {
      setDone(false)
      onClose()
    }, 1400)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-start p-4 pointer-events-none">
      <div className="pointer-events-auto w-80 bg-white rounded-xl shadow-2xl border border-gray-200 flex flex-col">
        {/* header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <span className="text-sm font-semibold text-gray-800">意見回饋</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X className="h-4 w-4" />
          </button>
        </div>

        {done ? (
          <div className="px-4 py-8 text-center text-sm text-green-600 font-medium">
            ✓ 已送出，謝謝你的回饋！
          </div>
        ) : (
          <div className="px-4 py-4 space-y-3">
            <div className="space-y-1">
              <label className="text-xs text-gray-500 font-medium">頁面</label>
              <select
                value={page}
                onChange={(e) => setPage(e.target.value)}
                className="w-full h-9 rounded-md border border-gray-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {PAGE_OPTIONS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-gray-500 font-medium">主題</label>
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="例：生成出來的文字有亂碼"
                className="w-full h-9 rounded-md border border-gray-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-gray-500 font-medium">回饋內容</label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="請描述你的使用體驗、問題或建議..."
                rows={4}
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <button
              onClick={handleSubmit}
              disabled={!topic.trim() || !content.trim()}
              className="w-full py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 transition"
            >
              送出回饋
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
