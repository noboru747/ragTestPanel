"use client"

export const runtime = 'edge'

import { useCallback, useEffect, useMemo, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { InlineSpinner, TableSkeleton } from "@/components/loading"
import { ChevronDown, Eye, EyeOff, Search, ShieldCheck, FileText, Lock } from "lucide-react"
import { BackendErrorBanner } from "@/components/backend-error-banner"
import { fetchJson } from "@/lib/backend-fetch"
import { MASK_LABELS, categoryLabel, type MaskMappingRow } from "@/lib/mask"

type Project = { id: string; name: string }

const HIDDEN = "●●●●"

function formatTime(s: string | undefined) {
  if (!s) return "—"
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString("zh-TW", { hour12: false })
}

export default function MaskMappingsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [projectsError, setProjectsError] = useState<string | null>(null)
  const [projectsLoading, setProjectsLoading] = useState(true)
  const [projectId, setProjectId] = useState("")

  const [rows, setRows] = useState<MaskMappingRow[] | null>(null)
  const [rowsError, setRowsError] = useState<string | null>(null)
  const [loadingRows, setLoadingRows] = useState(false)

  const [category, setCategory] = useState("")
  const [search, setSearch] = useState("")
  const [revealAll, setRevealAll] = useState(false)
  const [revealed, setRevealed] = useState<Set<string>>(new Set())

  const loadRows = useCallback(async (pid: string) => {
    setRevealed(new Set())
    setRevealAll(false)
    setRowsError(null)
    if (!pid) {
      setRows(null)
      return
    }
    setLoadingRows(true)
    setRows(null)
    const { data, error } = await fetchJson<{ mappings?: MaskMappingRow[] }>(
      `/api/mask/mappings?project_id=${encodeURIComponent(pid)}`
    )
    setLoadingRows(false)
    if (error) {
      setRowsError(error)
      setRows([])
      return
    }
    setRows(Array.isArray(data?.mappings) ? data.mappings : [])
  }, [])

  const selectProject = useCallback(
    (pid: string) => {
      setProjectId(pid)
      loadRows(pid)
    },
    [loadRows]
  )

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
    if (urlPid && list.some((p) => p.id === urlPid)) selectProject(urlPid)
    else if (list.length === 1) selectProject(list[0].id)
  }, [selectProject])

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  const categoriesInData = useMemo(() => {
    const set = new Set((rows ?? []).map((r) => r.category))
    return [...set].sort()
  }, [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows ?? []).filter((r) => {
      if (category && r.category !== category) return false
      if (!q) return true
      return (
        r.placeholder.toLowerCase().includes(q) ||
        categoryLabel(r.category).toLowerCase().includes(q) ||
        (r.filenames ?? []).some((f) => f.toLowerCase().includes(q)) ||
        // 原值只在顯示時才納入搜尋，避免隱藏狀態下以搜尋結果反推原值
        ((revealAll || revealed.has(r.placeholder)) && r.original.toLowerCase().includes(q))
      )
    })
  }, [rows, category, search, revealAll, revealed])

  const toggleRow = (ph: string) =>
    setRevealed((prev) => {
      const next = new Set(prev)
      if (next.has(ph)) next.delete(ph)
      else next.add(ph)
      return next
    })

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-amber-600" />
            遮罩對照表
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            文件入庫時被遮罩的敏感資料代號與原值對照
          </p>
          <p className="text-xs mt-1.5 inline-flex items-center gap-1 rounded-md border border-amber-300/60 bg-amber-50 px-2 py-1 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200 dark:border-amber-500/30">
            <Lock className="h-3 w-3" />
            此對照表僅存在本機資料庫，不會送至 AI 平台
          </p>
        </div>

        <div className="shrink-0">
          <label className="text-xs text-muted-foreground block mb-1">專案</label>
          <div className="relative">
            <select
              value={projectId}
              onChange={(e) => selectProject(e.target.value)}
              disabled={projectsLoading}
              aria-busy={projectsLoading}
              className="appearance-none text-sm border rounded-md px-3 py-1.5 pr-8 bg-background hover:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer min-w-[200px] disabled:cursor-wait disabled:opacity-70"
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

      <BackendErrorBanner message={projectsError} onRetry={loadProjects} />
      <BackendErrorBanner message={rowsError} onRetry={() => loadRows(projectId)} />

      {projectId && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜尋代號、類別、檔名…"
              className="pl-8 h-8 text-sm"
            />
          </div>
          <div className="relative">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="appearance-none text-sm border rounded-md px-3 py-1 pr-8 h-8 bg-background hover:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
            >
              <option value="">全部類別</option>
              {Object.keys(MASK_LABELS)
                .concat(categoriesInData.filter((c) => !(c in MASK_LABELS)))
                .map((c) => (
                  <option key={c} value={c}>
                    {categoryLabel(c)}
                  </option>
                ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          </div>
          <button
            onClick={() => {
              setRevealAll((v) => !v)
              setRevealed(new Set())
            }}
            disabled={!rows?.length}
            className="inline-flex items-center gap-1.5 text-sm border rounded-md px-3 h-8 hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {revealAll ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {revealAll ? "全部隱藏" : "全部顯示原值"}
          </button>
          {rows && (
            <span className="text-xs text-muted-foreground ml-auto">
              {filtered.length} / {rows.length} 筆
            </span>
          )}
        </div>
      )}

      {!projectId && projectsLoading ? (
        <TableSkeleton rows={4} />
      ) : !projectId ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            請先選擇專案以檢視其遮罩對照表
          </CardContent>
        </Card>
      ) : loadingRows ? (
        <TableSkeleton rows={5} />
      ) : rows && rows.length === 0 && !rowsError ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            此專案尚無遮罩對照資料（於 OCR 入庫勾選「敏感資料掃描遮罩」並指定專案後會自動建立）
          </CardContent>
        </Card>
      ) : rows && rows.length > 0 ? (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="text-left font-medium px-3 py-2">代號</th>
                  <th className="text-left font-medium px-3 py-2">類別</th>
                  <th className="text-left font-medium px-3 py-2">原值</th>
                  <th className="text-left font-medium px-3 py-2">出現檔案</th>
                  <th className="text-left font-medium px-3 py-2 whitespace-nowrap">更新時間</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const show = revealAll || revealed.has(r.placeholder)
                  return (
                    <tr key={r.placeholder} className="border-t align-top">
                      <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{r.placeholder}</td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className="text-[10px]">
                          {categoryLabel(r.category)}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`font-mono text-xs break-all ${
                              show
                                ? "rounded-sm bg-amber-100/70 px-1 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200"
                                : "text-muted-foreground tracking-widest"
                            }`}
                          >
                            {show ? r.original : HIDDEN}
                          </span>
                          {!revealAll && (
                            <button
                              onClick={() => toggleRow(r.placeholder)}
                              className="text-muted-foreground hover:text-foreground shrink-0"
                              aria-label={show ? "隱藏原值" : "顯示原值"}
                              title={show ? "隱藏原值" : "顯示原值"}
                            >
                              {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {(r.filenames ?? []).length === 0 ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            r.filenames.map((f) => (
                              <span
                                key={f}
                                className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px]"
                              >
                                <FileText className="h-3 w-3 text-muted-foreground" />
                                {f}
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                        {formatTime(r.updated_at)}
                      </td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-sm text-muted-foreground">
                      沒有符合篩選條件的項目
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
