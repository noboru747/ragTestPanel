export const runtime = 'edge'

"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { FileText, GitBranch, Clock, Search, TrendingUp, AlertCircle, Circle } from "lucide-react"
import type { MockProject } from "@/lib/mock-data"

const statusConfig = {
  active: { label: "進行中", color: "default", icon: TrendingUp },
  review: { label: "審查中", color: "secondary", icon: AlertCircle },
  planning: { label: "規劃中", color: "outline", icon: Circle },
} as const

export default function ProjectsPage() {
  const [projects, setProjects] = useState<MockProject[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => { setProjects(d.projects); setLoading(false) })
  }, [])

  const filtered = projects.filter(
    (p) =>
      p.name.includes(search) ||
      p.description.includes(search) ||
      p.tags.some((t) => t.includes(search))
  )

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">專案文件</h1>
          <p className="text-muted-foreground text-sm mt-1">選擇專案以瀏覽文件與知識庫</p>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="搜尋專案名稱或標籤..."
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="p-5 space-y-3">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-1/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {filtered.map((project) => {
            const sc = statusConfig[project.status as keyof typeof statusConfig] ?? statusConfig.active
            const Icon = sc.icon
            return (
              <Link key={project.id} href={`/projects/${project.id}`}>
                <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
                  <CardContent className="p-5 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold">{project.name}</p>
                      <Badge
                        variant={sc.color as "default" | "secondary" | "outline"}
                        className="shrink-0 flex items-center gap-1 text-xs"
                      >
                        <Icon className="h-3 w-3" />
                        {sc.label}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{project.description}</p>

                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <FileText className="h-3 w-3" />
                        {project.docCount} 份文件
                      </span>
                      {project.gitConnected ? (
                        <span className="flex items-center gap-1 text-green-600">
                          <GitBranch className="h-3 w-3" />
                          Git 已連結
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-muted-foreground/60">
                          <GitBranch className="h-3 w-3" />
                          未連結
                        </span>
                      )}
                      <span className="flex items-center gap-1 ml-auto">
                        <Clock className="h-3 w-3" />
                        {project.lastUpdated}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-1">
                      {project.tags.map((tag) => (
                        <Badge key={tag} variant="outline" className="text-[10px] px-1.5 py-0">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
          {filtered.length === 0 && (
            <p className="text-sm text-muted-foreground col-span-2 py-8 text-center">
              找不到符合的專案
            </p>
          )}
        </div>
      )}
    </div>
  )
}
