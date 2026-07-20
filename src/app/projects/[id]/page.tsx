export const runtime = 'edge'

"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import {
  FileText,
  FileSpreadsheet,
  Presentation,
  Image,
  File,
  ArrowLeft,
  GitBranch,
  Search,
  Tag,
  Upload,
  MessageSquareText,
  FolderOpen,
} from "lucide-react"
import { Input } from "@/components/ui/input"

type Project = {
  id: string
  name: string
  description: string
  status: string
  tags: string[]
  gitRepo: string | null
  gitConnected: boolean
  docCount: number
  lastUpdated: string
}

type Document = {
  id: string
  name: string
  type: "pdf" | "word" | "excel" | "ppt" | "image" | "file"
  size: string
  uploadedAt: string
  status: "indexed" | "processing" | "queued" | "error"
  tags: string[]
  summary: string
}

const docTypeConfig = {
  pdf:   { icon: FileText,        color: "text-red-500",    label: "PDF"   },
  word:  { icon: FileText,        color: "text-blue-500",   label: "Word"  },
  excel: { icon: FileSpreadsheet, color: "text-green-500",  label: "Excel" },
  ppt:   { icon: Presentation,    color: "text-orange-500", label: "PPT"   },
  image: { icon: Image,           color: "text-purple-500", label: "圖片"  },
  file:  { icon: File,            color: "text-muted-foreground", label: "檔案" },
} as const

const statusBadge = {
  indexed:    { label: "已索引", variant: "default"     as const },
  processing: { label: "處理中", variant: "secondary"   as const },
  queued:     { label: "排隊中", variant: "outline"     as const },
  error:      { label: "錯誤",   variant: "destructive" as const },
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<{ project: Project; documents: Document[] } | null>(null)
  const [search, setSearch] = useState("")

  useEffect(() => {
    fetch(`/api/projects/${id}`)
      .then((r) => r.json())
      .then(setData)
  }, [id])

  const filtered = (data?.documents ?? []).filter(
    (d) =>
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      d.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <div className="p-6 space-y-5">
      <Link
        href="/"
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground w-fit"
      >
        <ArrowLeft className="h-4 w-4" />
        返回儀表板
      </Link>

      {!data ? (
        <div className="space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96" />
        </div>
      ) : (
        <>
          {/* 專案標題列 */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold truncate">{data.project.name}</h1>
              <p className="text-muted-foreground text-sm mt-1">
                {data.project.description || "無描述"}
              </p>
              {data.project.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {data.project.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* 操作按鈕群 */}
            <div className="flex items-center gap-2 shrink-0">
              {data.project.gitConnected && (
                <Badge variant="secondary" className="flex items-center gap-1">
                  <GitBranch className="h-3 w-3" />
                  Git 已連結
                </Badge>
              )}
              <Link href={`/query?projectId=${id}`}>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <MessageSquareText className="h-4 w-4" />
                  知識查詢
                </Button>
              </Link>
              <Link href={`/ocr?projectId=${id}`}>
                <Button size="sm" className="gap-1.5">
                  <Upload className="h-4 w-4" />
                  匯入文件
                </Button>
              </Link>
            </div>
          </div>

          {/* 統計卡 */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "文件總數",  value: data.documents.length },
              { label: "已索引",   value: data.documents.filter((d) => d.status === "indexed").length },
              { label: "標籤種類", value: [...new Set(data.documents.flatMap((d) => d.tags))].length },
            ].map(({ label, value }) => (
              <Card key={label}>
                <CardContent className="p-3 text-center">
                  <p className="text-2xl font-bold">{value}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Separator />

          {/* 文件列表標題 */}
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">文件列表</h2>
            <div className="flex items-center gap-2">
              <div className="relative w-56">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="搜尋文件..."
                  className="pl-8 h-8 text-sm"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* 文件列表 */}
          <div className="space-y-2">
            {filtered.length === 0 && data.documents.length === 0 ? (
              /* 空狀態：引導去 OCR */
              <Card>
                <CardContent className="p-10 flex flex-col items-center gap-4 text-center">
                  <FolderOpen className="h-12 w-12 text-muted-foreground" />
                  <div>
                    <p className="font-medium">尚未匯入任何文件</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      上傳 PDF、Word、Excel、PPT 或圖片，系統會自動 OCR 提取並建立向量索引
                    </p>
                  </div>
                  <Link href={`/ocr?projectId=${id}`}>
                    <Button className="gap-2">
                      <Upload className="h-4 w-4" />
                      前往 OCR 匯入文件
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">找不到符合的文件</p>
            ) : (
              filtered.map((doc) => {
                const tc = docTypeConfig[doc.type] ?? docTypeConfig.file
                const Icon = tc.icon
                const sb = statusBadge[doc.status] ?? statusBadge.indexed
                return (
                  <Card key={doc.id} className="hover:border-primary/30 transition-colors">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <Icon className={`h-8 w-8 ${tc.color} shrink-0 mt-0.5`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium truncate">{doc.name}</p>
                            <Badge variant={sb.variant} className="text-[10px] px-1.5 py-0 shrink-0">
                              {sb.label}
                            </Badge>
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                              {tc.label}
                            </Badge>
                          </div>
                          {doc.summary && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                              {doc.summary}
                            </p>
                          )}
                          <div className="flex items-center gap-3 mt-2">
                            <span className="text-[11px] text-muted-foreground">{doc.size}</span>
                            <span className="text-[11px] text-muted-foreground">{doc.uploadedAt}</span>
                            {doc.tags.length > 0 && (
                              <div className="flex items-center gap-1 ml-auto">
                                <Tag className="h-3 w-3 text-muted-foreground" />
                                {doc.tags.map((tag) => (
                                  <Badge key={tag} variant="outline" className="text-[10px] px-1 py-0">
                                    {tag}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })
            )}
          </div>
        </>
      )}
    </div>
  )
}
