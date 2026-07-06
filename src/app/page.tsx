"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Progress } from "@/components/ui/progress"
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
  FolderOpen,
  FileText,
  MessageSquareText,
  GitBranch,
  TrendingUp,
  Clock,
  CheckCircle2,
  AlertCircle,
  Circle,
  Plus,
  X,
  Database,
  Loader2,
  Trash2,
} from "lucide-react"

type TemplateField = {
  key: string
  label: string
  type: "text" | "number" | "date" | "textarea"
}

type Template = {
  id: string
  name: string
  fields: TemplateField[]
  created_at: string
  updated_at: string
}

type Project = {
  id: string
  name: string
  description: string
  status: "active" | "review" | "planning" | "completed"
  docCount: number
  lastUpdated: string
  tags: string[]
  gitRepo: string | null
  gitConnected: boolean
}

type Stats = {
  totalProjects: number
  totalDocuments: number
  indexedDocuments: number
  totalQueries: number
}

const statusConfig = {
  active:    { label: "進行中", color: "default",   icon: TrendingUp  },
  review:    { label: "審查中", color: "secondary", icon: AlertCircle },
  planning:  { label: "規劃中", color: "outline",   icon: Circle      },
  completed: { label: "已完成", color: "secondary", icon: CheckCircle2 },
} as const

type GitStatus = "idle" | "checking" | "valid" | "invalid"

// 建立文件模板 Dialog
function NewTemplateDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState("")
  const [fields, setFields] = useState<{ label: string; type: TemplateField["type"] }[]>([])
  const [error, setError] = useState("")

  const reset = () => {
    setName("")
    setFields([])
    setError("")
  }

  const addField = () => {
    setFields((f) => [...f, { label: "", type: "text" }])
  }

  const removeField = (idx: number) => {
    setFields((f) => f.filter((_, i) => i !== idx))
  }

  const updateField = (
    idx: number,
    update: Partial<{ label: string; type: TemplateField["type"] }>
  ) => {
    setFields((f) => f.map((field, i) => (i === idx ? { ...field, ...update } : field)))
  }

  const generateKey = (label: string) =>
    label.toLowerCase().replace(/\s+/g, "_") +
    "_" +
    Date.now().toString(36).slice(-4)

  const submit = async () => {
    if (!name.trim()) { setError("模板名稱必填"); return }
    setLoading(true)
    setError("")

    const templateFields: TemplateField[] = fields.map((f) => ({
      key: generateKey(f.label || "field"),
      label: f.label,
      type: f.type,
    }))

    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), fields: templateFields }),
      })
      if (res.ok) {
        setOpen(false)
        reset()
        onCreated()
      } else {
        const d = await res.json()
        setError(d.detail ?? d.error ?? "建立失敗")
      }
    } catch {
      setError("無法連線至伺服器")
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} className="gap-1.5">
        <Plus className="h-4 w-4" />
        建立文件模板
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v: boolean) => {
          setOpen(v)
          if (!v) reset()
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>建立文件模板</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* 模板名稱 */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">模板名稱 *</label>
              <Input
                placeholder="例：採購申請單"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                autoFocus
              />
            </div>

            {/* 欄位清單 */}
            <div>
              <label className="text-xs text-muted-foreground mb-2 block">欄位定義</label>
              <div className="space-y-2">
                {fields.map((field, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Input
                      placeholder="欄位名稱"
                      value={field.label}
                      onChange={(e) => updateField(idx, { label: e.target.value })}
                      className="flex-1"
                    />
                    <select
                      value={field.type}
                      onChange={(e) =>
                        updateField(idx, { type: e.target.value as TemplateField["type"] })
                      }
                      className="h-9 rounded-md border border-input bg-background px-2 text-sm focus:outline-none shrink-0"
                    >
                      <option value="text">字串</option>
                      <option value="number">數字</option>
                      <option value="date">日期</option>
                      <option value="textarea">多行文字</option>
                    </select>
                    <button
                      onClick={() => removeField(idx)}
                      className="text-muted-foreground hover:text-destructive shrink-0"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={addField}
                className="mt-2 gap-1 w-full"
              >
                <Plus className="h-3 w-3" />
                新增欄位
              </Button>
            </div>

            {error && <p className="text-xs text-red-500">{error}</p>}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setOpen(false); reset() }}
            >
              取消
            </Button>
            <Button onClick={submit} disabled={loading}>
              {loading ? "建立中..." : "建立模板"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// 新增專案表單
function NewProjectDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ name: "", description: "", tags: "", gitUrl: "" })
  const [gitStatus, setGitStatus] = useState<GitStatus>("idle")
  const [gitReason, setGitReason] = useState("")
  const [error, setError] = useState("")

  // Git URL 驗證（輸入停止 800ms 後觸發）
  useEffect(() => {
    const url = form.gitUrl.trim()
    if (!url) { setGitStatus("idle"); setGitReason(""); return }
    if (!url.startsWith("http://") && !url.startsWith("https://") && !url.startsWith("git@")) {
      setGitStatus("invalid"); setGitReason("URL 格式不正確"); return
    }

    setGitStatus("checking")
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/git/validate?url=${encodeURIComponent(url)}`)
        const data = await res.json()
        setGitStatus(data.valid ? "valid" : "invalid")
        setGitReason(data.reason ?? "")
      } catch {
        setGitStatus("invalid")
        setGitReason("驗證服務無法連線")
      }
    }, 800)
    return () => clearTimeout(timer)
  }, [form.gitUrl])

  const reset = () => {
    setForm({ name: "", description: "", tags: "", gitUrl: "" })
    setGitStatus("idle")
    setGitReason("")
    setError("")
  }

  const submit = async () => {
    if (!form.name.trim()) { setError("專案名稱必填"); return }
    if (form.gitUrl && gitStatus === "checking") { setError("請等待 Git 驗證完成"); return }
    setLoading(true)
    setError("")

    const id = "proj-" + form.name
      .toLowerCase()
      .replace(/[\s一-鿿]+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .slice(0, 30) + "-" + Date.now().toString(36)

    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        name: form.name.trim(),
        description: form.description.trim(),
        git_url: gitStatus === "valid" ? form.gitUrl.trim() : null,
        tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
        status: "active",
      }),
    })

    setLoading(false)
    if (res.ok) {
      setOpen(false)
      reset()
      onCreated()
    } else {
      const d = await res.json()
      setError(d.detail ?? d.error ?? "建立失敗")
    }
  }

  const gitIcon = () => {
    if (gitStatus === "checking") return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
    if (gitStatus === "valid")    return <CheckCircle2 className="h-4 w-4 text-green-500" />
    if (gitStatus === "invalid")  return <AlertCircle  className="h-4 w-4 text-red-500" />
    return null
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)} className="gap-1.5">
        <Plus className="h-4 w-4" />
        新增專案
      </Button>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">新增專案</CardTitle>
          <button onClick={() => { setOpen(false); reset() }}>
            <X className="h-4 w-4 text-muted-foreground hover:text-foreground" />
          </button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">專案名稱 *</label>
            <Input
              placeholder="例：ERP 系統升級"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">描述</label>
            <Input
              placeholder="簡短說明專案目的"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">標籤（逗號分隔）</label>
            <Input
              placeholder="例：React, 後端, API"
              value={form.tags}
              onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
            />
          </div>

          {/* Git URL + 即時驗證 */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5 block">
              <GitBranch className="h-3 w-3" />
              Git Repo URL（選填）
            </label>
            <div className="relative">
              <Input
                placeholder="https://github.com/org/repo"
                value={form.gitUrl}
                onChange={(e) => setForm((f) => ({ ...f, gitUrl: e.target.value }))}
                className={
                  gitStatus === "valid"   ? "border-green-500 pr-9" :
                  gitStatus === "invalid" ? "border-red-400 pr-9"   : "pr-9"
                }
              />
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                {gitIcon()}
              </div>
            </div>
            {gitStatus === "valid" && (
              <p className="text-[11px] text-green-600 mt-1 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Repo 可連線，建立後可直接 clone
              </p>
            )}
            {gitStatus === "invalid" && (
              <p className="text-[11px] text-red-500 mt-1 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {gitReason || "無法連線至此 Repo"}
                <span className="text-muted-foreground">（仍可建立專案，但不連結 Git）</span>
              </p>
            )}
            {gitStatus === "checking" && (
              <p className="text-[11px] text-muted-foreground mt-1">正在驗證 Repo 連線...</p>
            )}
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2 pt-1">
            <Button onClick={submit} disabled={loading || gitStatus === "checking"} className="flex-1">
              {loading ? "建立中..." : "建立"}
            </Button>
            <Button variant="outline" onClick={() => { setOpen(false); reset() }}>取消</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default function DashboardPage() {
  const [data, setData] = useState<{ projects: Project[]; stats: Stats } | null>(null)
  const [isRealData, setIsRealData] = useState(false)
  const [templates, setTemplates] = useState<Template[] | null>(null)

  const load = useCallback(() => {
    setData(null)
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => {
        setData(d)
        // mock 資料固定值：totalProjects=4, projects.length=4
        // 兩者皆符合才視為 mock，否則判斷為真實資料
        const isMockData = d.stats?.totalProjects === 4 && d.projects?.length === 4
        setIsRealData(!isMockData)
      })
  }, [])

  const loadTemplates = useCallback(() => {
    setTemplates(null)
    fetch("/api/templates")
      .then((r) => r.json())
      .then((d) => setTemplates(d.templates ?? []))
      .catch(() => setTemplates([]))
  }, [])

  const deleteTemplate = async (id: string) => {
    await fetch(`/api/templates/${id}`, { method: "DELETE" })
    loadTemplates()
  }

  useEffect(() => { load() }, [load])
  useEffect(() => { loadTemplates() }, [loadTemplates])

  const stats = data?.stats
  const projects = data?.projects ?? []

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">儀表板</h1>
          <p className="text-muted-foreground text-sm mt-1 flex items-center gap-1.5">
            PM 專案知識管理總覽
            {isRealData && (
              <span className="inline-flex items-center gap-1 text-green-600 text-xs">
                <Database className="h-3 w-3" />
                即時資料
              </span>
            )}
          </p>
        </div>
        <NewProjectDialog onCreated={load} />
      </div>

      {/* 統計卡片 */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: "專案數量",   value: stats?.totalProjects,    icon: FolderOpen,       color: "text-blue-500"   },
          { label: "文件總數",   value: stats?.totalDocuments,   icon: FileText,         color: "text-green-500"  },
          { label: "已建立索引", value: stats?.indexedDocuments, icon: CheckCircle2,     color: "text-purple-500" },
          { label: "查詢次數",   value: stats?.totalQueries,     icon: MessageSquareText, color: "text-orange-500" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardContent className="p-4 flex items-center gap-4">
              <div className={`rounded-lg bg-muted p-2 ${color}`}>
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{label}</p>
                {value != null ? (
                  <p className="text-2xl font-bold">{value}</p>
                ) : (
                  <Skeleton className="h-8 w-12 mt-1" />
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 索引進度 */}
      {stats && stats.totalDocuments > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">文件索引進度</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <Progress
                value={(stats.indexedDocuments / stats.totalDocuments) * 100}
                className="flex-1"
              />
              <span className="text-sm text-muted-foreground w-16 text-right">
                {stats.indexedDocuments} / {stats.totalDocuments}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 專案列表 */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">專案列表</h2>
          <Link href="/projects" className="text-sm text-primary hover:underline">
            查看全部
          </Link>
        </div>

        {!data ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i}>
                <CardContent className="p-4 space-y-3">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-1/2" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : projects.length === 0 ? (
          <Card>
            <CardContent className="p-10 flex flex-col items-center gap-3 text-center">
              <FolderOpen className="h-10 w-10 text-muted-foreground" />
              <p className="font-medium text-sm">尚未建立任何專案</p>
              <p className="text-xs text-muted-foreground">點擊右上角「新增專案」開始</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {projects.map((project) => {
              const sc = statusConfig[project.status] ?? statusConfig.active
              const Icon = sc.icon
              return (
                <Link key={project.id} href={`/projects/${project.id}`}>
                  <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-sm">{project.name}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                            {project.description || "無描述"}
                          </p>
                        </div>
                        <Badge
                          variant={sc.color as "default" | "secondary" | "outline"}
                          className="shrink-0 flex items-center gap-1 text-xs"
                        >
                          <Icon className="h-3 w-3" />
                          {sc.label}
                        </Badge>
                      </div>

                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <FileText className="h-3 w-3" />
                          {project.docCount} 份文件
                        </span>
                        {project.gitConnected && (
                          <span className="flex items-center gap-1 text-green-600">
                            <GitBranch className="h-3 w-3" />
                            Git 已連結
                          </span>
                        )}
                        <span className="flex items-center gap-1 ml-auto">
                          <Clock className="h-3 w-3" />
                          {project.lastUpdated}
                        </span>
                      </div>

                      {project.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {project.tags.map((tag) => (
                            <Badge key={tag} variant="outline" className="text-[10px] px-1.5 py-0">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </Link>
              )
            })}
          </div>
        )}
      </div>

      {/* 文件模板管理 */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">文件模板管理</h2>
          <NewTemplateDialog onCreated={loadTemplates} />
        </div>

        {!templates ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {[1, 2].map((i) => (
              <Card key={i}>
                <CardContent className="p-4 space-y-3">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : templates.length === 0 ? (
          <Card>
            <CardContent className="p-10 flex flex-col items-center gap-3 text-center">
              <FileText className="h-10 w-10 text-muted-foreground" />
              <p className="font-medium text-sm">尚無文件模板</p>
              <p className="text-xs text-muted-foreground">點擊「建立文件模板」開始新增</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {templates.map((tmpl) => (
              <Link key={tmpl.id} href={`/templates/${tmpl.id}`}>
                <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-sm">{tmpl.name}</p>
                      <button
                        onClick={(e) => {
                          e.preventDefault()
                          deleteTemplate(tmpl.id)
                        }}
                        className="text-muted-foreground hover:text-destructive shrink-0 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <FileText className="h-3 w-3" />
                        {tmpl.fields.length} 個欄位
                      </span>
                      <span className="flex items-center gap-1 ml-auto">
                        <Clock className="h-3 w-3" />
                        {new Date(tmpl.created_at).toLocaleDateString("zh-TW")}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* 快捷操作 */}
      <div>
        <h2 className="font-semibold mb-3">快捷操作</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { href: "/query",    icon: MessageSquareText, label: "知識查詢",    desc: "用自然語言問問題" },
            { href: "/git",      icon: GitBranch,         label: "連結 Git Repo", desc: "掛載專案程式碼" },
            { href: "/generate", icon: FileText,           label: "生成文件",    desc: "AI 自動產生"    },
            { href: "/projects", icon: FolderOpen,         label: "瀏覽文件",    desc: "查看所有文件"   },
          ].map(({ href, icon: Icon, label, desc }) => (
            <Link key={href} href={href}>
              <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
                <CardContent className="p-4 flex flex-col items-center text-center gap-2">
                  <Icon className="h-8 w-8 text-primary" />
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
