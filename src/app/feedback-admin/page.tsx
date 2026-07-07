"use client"

import { useEffect, useState } from "react"
import { Trash2, RefreshCw } from "lucide-react"
import { type FeedbackEntry } from "@/components/layout/FeedbackModal"

const PAGE_COLORS: Record<string, string> = {
  "儀表板":            "bg-blue-100 text-blue-700",
  "知識查詢":          "bg-purple-100 text-purple-700",
  "生成文件 — 填寫表單": "bg-amber-100 text-amber-700",
  "生成文件 — 預覽 PDF": "bg-orange-100 text-orange-700",
  "OCR 入庫":          "bg-green-100 text-green-700",
  "Git 整合":          "bg-gray-100 text-gray-700",
  "其他":              "bg-slate-100 text-slate-700",
}

function pageBadge(page: string) {
  const cls = PAGE_COLORS[page] ?? "bg-slate-100 text-slate-700"
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>
      {page}
    </span>
  )
}

export default function FeedbackAdminPage() {
  const [entries, setEntries] = useState<FeedbackEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filterPage, setFilterPage] = useState("全部")

  const refresh = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/feedback")
      const data = await res.json()
      setEntries(data.feedback ?? [])
    } catch {
      setEntries([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [])

  const pages = ["全部", ...Array.from(new Set(entries.map((e) => e.page)))]
  const filtered = filterPage === "全部" ? entries : entries.filter((e) => e.page === filterPage)

  const handleDelete = async (id: string) => {
    await fetch(`/api/feedback/${id}`, { method: "DELETE" })
    setEntries((prev) => prev.filter((e) => e.id !== id))
  }

  const handleClearAll = async () => {
    if (!confirm("確定清除所有回饋記錄？")) return
    await Promise.all(entries.map((e) => fetch(`/api/feedback/${e.id}`, { method: "DELETE" })))
    setEntries([])
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">回饋管理</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            共 {entries.length} 筆 · dev 模式
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={refresh}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 transition"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            重新整理
          </button>
          <button
            onClick={handleClearAll}
            disabled={entries.length === 0}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-red-200 rounded-md text-red-500 hover:bg-red-50 transition disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
            清除全部
          </button>
        </div>
      </div>

      {/* filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {pages.map((p) => (
          <button
            key={p}
            onClick={() => setFilterPage(p)}
            className={`text-xs px-3 py-1 rounded-full border transition ${
              filterPage === p
                ? "bg-primary text-primary-foreground border-primary"
                : "border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}
          >
            {p}
            {p !== "全部" && (
              <span className="ml-1 text-[10px] opacity-70">
                {entries.filter((e) => e.page === p).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* list */}
      {loading ? (
        <div className="text-center py-16 text-muted-foreground text-sm">載入中...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">尚無回饋記錄</div>
      ) : (
        <div className="space-y-3">
          {filtered.map((entry) => (
            <div
              key={entry.id}
              className="bg-white border border-gray-200 rounded-xl p-4 space-y-2 hover:shadow-sm transition"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                  {pageBadge(entry.page)}
                  <span className="font-medium text-gray-900 text-sm">{entry.topic}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-gray-400">
                    {new Date(entry.submittedAt).toLocaleString("zh-TW", {
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <button
                    onClick={() => handleDelete(entry.id)}
                    className="text-gray-300 hover:text-red-500 transition"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <p className="text-sm text-gray-700 whitespace-pre-line leading-relaxed">
                {entry.content}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
