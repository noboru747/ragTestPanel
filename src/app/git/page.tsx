export const runtime = 'edge'

"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  GitBranch,
  GitPullRequest,
  Folder,
  FileText,
  Loader2,
  CheckCircle2,
  RefreshCw,
  Zap,
} from "lucide-react"
import { mockGitRepo } from "@/lib/mock-data"

type RepoState = typeof mockGitRepo | null

export default function GitPage() {
  const [url, setUrl] = useState("")
  const [loading, setLoading] = useState(false)
  const [repo, setRepo] = useState<RepoState>(mockGitRepo)

  const handleClone = async () => {
    if (!url.trim()) return
    setLoading(true)
    const res = await fetch("/api/git", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    })
    const data = await res.json()
    setLoading(false)
    if (data.success) setRepo(data.repo)
  }

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Git 整合</h1>
        <p className="text-muted-foreground text-sm mt-1">
          連結 Git Repo，讓 AI 讀取專案結構與功能清單
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <GitPullRequest className="h-4 w-4" />
            連結新 Repo
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="https://github.com/org/project"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleClone()}
              className="flex-1"
            />
            <Button onClick={handleClone} disabled={loading || !url.trim()}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Clone 中...
                </>
              ) : (
                <>
                  <GitBranch className="h-4 w-4 mr-2" />
                  Clone
                </>
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            系統將 clone Repo 並解析 MD 文件、功能清單與部署設定
          </p>
        </CardContent>
      </Card>

      {repo && (
        <>
          <Card className="border-green-200 bg-green-50/30 dark:border-green-800 dark:bg-green-950/20">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <p className="font-medium text-sm">Repo 已連結</p>
                  </div>
                  <p className="text-xs text-muted-foreground font-mono">{repo.url}</p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                    <Badge variant="outline" className="text-[10px]">
                      {repo.branch}
                    </Badge>
                    <span>上次同步：{new Date(repo.lastPulled).toLocaleString("zh-TW")}</span>
                  </div>
                </div>
                <Button variant="outline" size="sm" className="gap-1">
                  <RefreshCw className="h-3.5 w-3.5" />
                  Pull
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Folder className="h-4 w-4" />
                  專案結構
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-48">
                  <div className="space-y-1 font-mono text-xs">
                    {repo.structure.map((item) => (
                      <div
                        key={item.path}
                        className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {item.type === "dir" ? (
                          <Folder className="h-3.5 w-3.5 shrink-0 text-blue-400" />
                        ) : (
                          <FileText className="h-3.5 w-3.5 shrink-0" />
                        )}
                        <span>{item.path}</span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Zap className="h-4 w-4" />
                  已識別功能（供 AI 生成文件用）
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-48">
                  <div className="space-y-2">
                    {repo.features.map((feature, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm">
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />
                        <span>{feature}</span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>

          <Separator />

          <div>
            <h2 className="font-semibold text-sm mb-3">MD 擴充機制</h2>
            <Card className="bg-muted/40">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground mb-3">
                  在 Repo 的 MD 文件中登記新需求，AI 會自動解析並納入文件生成範圍：
                </p>
                <pre className="text-xs font-mono bg-background rounded-md p-3 overflow-x-auto">{`## 新需求登記

### 功能：庫存預警通知
- 觸發條件：庫存低於安全庫存量
- 通知方式：Email + 系統提示
- 負責人：@developer-a

### 指令給 AI
生成：功能說明書、API 規格、測試計畫`}</pre>
                <p className="text-[11px] text-muted-foreground mt-2">
                  → 儲存後下次 Pull 時，AI 自動識別並加入生成清單
                </p>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
