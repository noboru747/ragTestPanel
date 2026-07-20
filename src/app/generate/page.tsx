export const runtime = 'edge'

"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { FileText, Sparkles } from "lucide-react"

type Template = {
  id: string
  name: string
  type: string
  description: string
  fields: string[]
}

export default function GeneratePage() {
  const router = useRouter()
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/templates")
      .then(r => r.ok ? r.json() : { templates: [] })
      .then((data: { templates?: Template[] }) => {
        setTemplates(data.templates ?? [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">生成文件</h1>
        <p className="text-muted-foreground text-sm mt-1">
          選擇文件類型，填寫資料後由 AI 根據專案知識庫生成草稿
        </p>
      </div>

      {loading ? (
        <Card>
          <CardContent className="p-10 flex flex-col items-center gap-3 text-center">
            <p className="font-medium text-sm text-muted-foreground">載入模板中...</p>
          </CardContent>
        </Card>
      ) : templates.length === 0 ? (
        <Card>
          <CardContent className="p-10 flex flex-col items-center gap-3 text-center">
            <FileText className="h-10 w-10 text-muted-foreground opacity-40" />
            <p className="font-medium text-sm">尚無可用的文件生成模板</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {templates.map((tmpl) => (
            <Card key={tmpl.id} className="hover:border-primary/50 transition-colors">
              <CardContent className="p-5 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-muted p-2 text-primary shrink-0">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm">{tmpl.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                      {tmpl.description}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-muted-foreground">
                    {tmpl.fields.length} 個必填欄位：{tmpl.fields.join("、")}
                  </span>
                  <Button
                    size="sm"
                    className="gap-1.5 shrink-0"
                    onClick={() => router.push(`/generate/${tmpl.id}`)}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    開始生成
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
