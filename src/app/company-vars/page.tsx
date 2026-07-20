export const runtime = 'edge'

"use client"

import { useEffect, useState } from "react"
import { Trash2, RefreshCw, Plus } from "lucide-react"
import { getAutoFillLabel } from "@/lib/companyVarsMap"

type VarEntry = {
  key: string
  value: string
}

type Project = {
  id: string
  name: string
}

export default function CompanyVarsPage() {
  /* ── Tab state ───────────────────────────────────────────────── */
  const [tab, setTab] = useState<'global' | 'project'>('global')

  /* ── 公用設定 state ──────────────────────────────────────────── */
  const [vars, setVars] = useState<VarEntry[]>([])
  const [loading, setLoading] = useState(true)

  const [newKey, setNewKey] = useState("")
  const [newValue, setNewValue] = useState("")
  const [saving, setSaving] = useState(false)

  const [search, setSearch] = useState("")

  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState("")

  /* ── 專案設定 state ──────────────────────────────────────────── */
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjId, setSelectedProjId] = useState("")
  const [projVars, setProjVars] = useState<VarEntry[]>([])
  const [projLoading, setProjLoading] = useState(false)

  const [projNewKey, setProjNewKey] = useState("")
  const [projNewValue, setProjNewValue] = useState("")
  const [projSaving, setProjSaving] = useState(false)

  const [projSearch, setProjSearch] = useState("")

  const [projEditingKey, setProjEditingKey] = useState<string | null>(null)
  const [projEditingValue, setProjEditingValue] = useState("")

  /* ── 公用設定 functions ──────────────────────────────────────── */
  const refresh = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/company-vars")
      const data = await res.json()
      setVars(data.vars ?? [])
    } catch {
      setVars([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [])

  const handleSave = async () => {
    const key = newKey.trim()
    const value = newValue.trim()
    if (!key || !value) return

    if (vars.some(v => v.key === key)) {
      window.alert(`「${key}」已存在，請直接在下方修改`)
      return
    }

    setSaving(true)
    try {
      await fetch("/api/company-vars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      })
      setNewKey("")
      setNewValue("")
      await refresh()
    } finally {
      setSaving(false)
    }
  }

  const handleInlineSave = async (key: string) => {
    const value = editingValue.trim()
    if (!value) return
    try {
      await fetch("/api/company-vars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      })
      setEditingKey(null)
      await refresh()
    } catch {}
  }

  const handleDelete = async (key: string) => {
    if (!confirm(`確定刪除「${key}」？`)) return
    try {
      await fetch(`/api/company-vars/${encodeURIComponent(key)}`, { method: "DELETE" })
      setVars(prev => prev.filter(v => v.key !== key))
    } catch {}
  }

  const filtered = vars.filter(v =>
    v.key.includes(search) || v.value.includes(search)
  )

  /* ── 專案設定 functions ──────────────────────────────────────── */
  const refreshProjVars = async (projId: string) => {
    if (!projId) return
    setProjLoading(true)
    try {
      const res = await fetch(`/api/company-vars/project/${projId}`)
      const data = await res.json()
      setProjVars(data.vars ?? [])
    } catch {
      setProjVars([])
    } finally {
      setProjLoading(false)
    }
  }

  useEffect(() => {
    fetch("/api/projects")
      .then(r => r.json())
      .then(d => {
        const list: Project[] = d.projects ?? []
        setProjects(list)
        if (list.length > 0) setSelectedProjId(list[0].id)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (selectedProjId) {
      refreshProjVars(selectedProjId)
    } else {
      setProjVars([])
    }
  }, [selectedProjId])

  const handleProjSave = async () => {
    const key = projNewKey.trim()
    const value = projNewValue.trim()
    if (!key || !value) return

    if (projVars.some(v => v.key === key)) {
      window.alert(`「${key}」已存在，請直接在下方修改`)
      return
    }

    setProjSaving(true)
    try {
      await fetch(`/api/company-vars/project/${selectedProjId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      })
      setProjNewKey("")
      setProjNewValue("")
      await refreshProjVars(selectedProjId)
    } finally {
      setProjSaving(false)
    }
  }

  const handleProjInlineSave = async (key: string) => {
    const value = projEditingValue.trim()
    if (!value) return
    try {
      await fetch(`/api/company-vars/project/${selectedProjId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      })
      setProjEditingKey(null)
      await refreshProjVars(selectedProjId)
    } catch {}
  }

  const handleProjDelete = async (key: string) => {
    if (!confirm(`確定刪除「${key}」？`)) return
    try {
      await fetch(
        `/api/company-vars/project/${selectedProjId}/${encodeURIComponent(key)}`,
        { method: "DELETE" }
      )
      setProjVars(prev => prev.filter(v => v.key !== key))
    } catch {}
  }

  const projFiltered = projVars.filter(v =>
    v.key.includes(projSearch) || v.value.includes(projSearch)
  )

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">資訊管理</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            設定常駐變數，生成文件時自動帶入對應欄位
          </p>
        </div>
        <button
          onClick={refresh}
          className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 transition"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          重新整理
        </button>
      </div>

      {/* ── Tab bar ────────────────────────────────────────────────── */}
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => setTab('global')}
          className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            tab === 'global'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          公用設定
        </button>
        <button
          onClick={() => setTab('project')}
          className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            tab === 'project'
              ? 'border-amber-500 text-amber-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          專案設定
        </button>
      </div>

      {/* ════════════════════════════════════════════════════════
          公用設定區塊
      ════════════════════════════════════════════════════════ */}
      {tab === 'global' && <>

      <p className="text-xs text-muted-foreground -mt-4">適用所有專案的共用變數</p>

      {/* 新增表單 */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <p className="text-sm font-semibold text-gray-700">新增變數</p>

        <div className="flex gap-2">
          <input
            value={newKey}
            onChange={e => setNewKey(e.target.value)}
            placeholder="變數名稱，例：投標公司"
            className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <input
            value={newValue}
            onChange={e => setNewValue(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleSave() }}
            placeholder="值"
            className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={handleSave}
            disabled={saving || !newKey.trim() || !newValue.trim()}
            className="flex items-center gap-1.5 text-sm px-4 py-1.5 bg-primary text-primary-foreground rounded-md hover:opacity-90 disabled:opacity-40 transition"
          >
            <Plus className="h-3.5 w-3.5" />
            {saving ? "儲存中..." : "新增"}
          </button>
        </div>
      </div>

      {/* 全域變數清單 */}
      {loading ? (
        <div className="text-center py-16 text-muted-foreground text-sm">載入中...</div>
      ) : vars.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">尚無常駐變數</div>
      ) : (
        <div className="space-y-2">
          {/* 搜尋欄 */}
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm font-semibold text-gray-700">已儲存變數（{vars.length}）</p>
            <input
              type="text"
              placeholder="搜尋變數名稱或值..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-8 w-56 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {filtered.length === 0 && (
            <div className="text-center py-10 text-muted-foreground text-sm">無符合的變數</div>
          )}

          {filtered.map(({ key, value }) => {
            const autoLabel = getAutoFillLabel(key)
            const isEditing = editingKey === key

            return (
              <div
                key={key}
                className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-3 hover:shadow-sm transition"
              >
                {/* key 欄 */}
                <div className="w-36 shrink-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{key}</p>
                </div>

                {/* value 欄（可 inline 編輯） */}
                <div className="flex-1">
                  {isEditing ? (
                    <input
                      autoFocus
                      value={editingValue}
                      onChange={e => setEditingValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") handleInlineSave(key)
                        if (e.key === "Escape") setEditingKey(null)
                      }}
                      className="w-full h-8 rounded border border-amber-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                  ) : (
                    <button
                      onClick={() => { setEditingKey(key); setEditingValue(value) }}
                      className="text-sm text-gray-700 hover:text-amber-600 text-left w-full truncate"
                      title="點擊編輯"
                    >
                      {value}
                    </button>
                  )}
                </div>

                {/* 操作按鈕 */}
                <div className="flex items-center gap-2 shrink-0">
                  {isEditing ? (
                    <>
                      <button
                        onClick={() => handleInlineSave(key)}
                        className="text-xs px-3 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded transition"
                      >
                        確認
                      </button>
                      <button
                        onClick={() => setEditingKey(null)}
                        className="text-xs px-3 py-1 border border-gray-300 rounded text-gray-600 hover:bg-gray-50 transition"
                      >
                        取消
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => handleDelete(key)}
                      className="text-gray-300 hover:text-red-500 transition"
                      title="刪除"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      </>}

      {/* ════════════════════════════════════════════════════════
          專案設定區塊
      ════════════════════════════════════════════════════════ */}
      {tab === 'project' && <>

      <p className="text-xs text-muted-foreground -mt-4">覆蓋公用設定，僅套用至所選專案</p>

      {/* 專案選擇器 */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
        <p className="text-sm font-semibold text-gray-700">選擇專案</p>
        {projects.length === 0 ? (
          <p className="text-xs text-muted-foreground">（載入專案清單中...）</p>
        ) : (
          <select
            value={selectedProjId}
            onChange={e => setSelectedProjId(e.target.value)}
            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* 新增專案變數表單 */}
      {selectedProjId && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <p className="text-sm font-semibold text-gray-700">新增專案變數</p>

          <div className="flex gap-2">
            <input
              value={projNewKey}
              onChange={e => setProjNewKey(e.target.value)}
              placeholder="變數名稱，例：投標公司"
              className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <input
              value={projNewValue}
              onChange={e => setProjNewValue(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleProjSave() }}
              placeholder="值"
              className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              onClick={handleProjSave}
              disabled={projSaving || !projNewKey.trim() || !projNewValue.trim()}
              className="flex items-center gap-1.5 text-sm px-4 py-1.5 bg-primary text-primary-foreground rounded-md hover:opacity-90 disabled:opacity-40 transition"
            >
              <Plus className="h-3.5 w-3.5" />
              {projSaving ? "儲存中..." : "新增"}
            </button>
          </div>
        </div>
      )}

      {/* 專案變數清單 */}
      {selectedProjId && (
        projLoading ? (
          <div className="text-center py-10 text-muted-foreground text-sm">載入中...</div>
        ) : projVars.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground text-sm">此專案尚無專案變數</div>
        ) : (
          <div className="space-y-2">
            {/* 搜尋欄 */}
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-semibold text-gray-700">已儲存專案變數（{projVars.length}）</p>
              <input
                type="text"
                placeholder="搜尋變數名稱或值..."
                value={projSearch}
                onChange={e => setProjSearch(e.target.value)}
                className="h-8 w-56 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {projFiltered.length === 0 && (
              <div className="text-center py-10 text-muted-foreground text-sm">無符合的變數</div>
            )}

            {projFiltered.map(({ key, value }) => {
              const autoLabel = getAutoFillLabel(key)
              const isEditing = projEditingKey === key

              return (
                <div
                  key={key}
                  className="bg-white border border-amber-100 rounded-xl px-4 py-3 flex items-center gap-3 hover:shadow-sm transition"
                >
                  {/* key 欄 */}
                  <div className="w-36 shrink-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{key}</p>
                  </div>

                  {/* value 欄（可 inline 編輯） */}
                  <div className="flex-1">
                    {isEditing ? (
                      <input
                        autoFocus
                        value={projEditingValue}
                        onChange={e => setProjEditingValue(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter") handleProjInlineSave(key)
                          if (e.key === "Escape") setProjEditingKey(null)
                        }}
                        className="w-full h-8 rounded border border-amber-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                      />
                    ) : (
                      <button
                        onClick={() => { setProjEditingKey(key); setProjEditingValue(value) }}
                        className="text-sm text-gray-700 hover:text-amber-600 text-left w-full truncate"
                        title="點擊編輯"
                      >
                        {value}
                      </button>
                    )}
                  </div>

                  {/* 操作按鈕 */}
                  <div className="flex items-center gap-2 shrink-0">
                    {isEditing ? (
                      <>
                        <button
                          onClick={() => handleProjInlineSave(key)}
                          className="text-xs px-3 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded transition"
                        >
                          確認
                        </button>
                        <button
                          onClick={() => setProjEditingKey(null)}
                          className="text-xs px-3 py-1 border border-gray-300 rounded text-gray-600 hover:bg-gray-50 transition"
                        >
                          取消
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => handleProjDelete(key)}
                        className="text-gray-300 hover:text-red-500 transition"
                        title="刪除"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )
      )}

      </>}
    </div>
  )
}
