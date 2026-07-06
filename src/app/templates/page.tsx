"use client"

import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import {
  FileText,
  Plus,
  Search,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Check,
  X,
} from "lucide-react"
import { mockTemplates, type DocumentTemplate, type TemplateField } from "@/lib/mock-templates"

const fieldTypeLabels: Record<string, string> = {
  text: "單行文字",
  textarea: "多行文字",
  number: "數字",
  date: "日期",
  select: "下拉選單",
  image: "圖片上傳",
  file: "檔案上傳",
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<DocumentTemplate[]>(mockTemplates)
  const [search, setSearch] = useState("")
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState("")

  const filtered = templates.filter(
    (t) =>
      t.name.includes(search) ||
      t.category.includes(search) ||
      t.tags.some((tag) => tag.includes(search))
  )

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  const startEdit = (tmpl: DocumentTemplate) => {
    setEditingId(tmpl.id)
    setEditName(tmpl.name)
  }

  const saveEdit = (id: string) => {
    setTemplates((prev) =>
      prev.map((t) => (t.id === id ? { ...t, name: editName } : t))
    )
    setEditingId(null)
  }

  const deleteTemplate = (id: string) => {
    setTemplates((prev) => prev.filter((t) => t.id !== id))
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">文件模板編輯清單</h1>
          <p className="text-muted-foreground text-sm mt-1">
            管理文件生成的模板定義與欄位結構
          </p>
        </div>
        <Button size="sm" className="gap-1">
          <Plus className="h-4 w-4" />
          新增模板
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="搜尋模板名稱或類別..."
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        {filtered.map((tmpl) => {
          const isExpanded = expandedId === tmpl.id
          const isEditing = editingId === tmpl.id
          const requiredCount = tmpl.fields.filter((f) => f.required).length

          return (
            <Card key={tmpl.id} className="overflow-hidden">
              <CardContent className="p-0">
                {/* 模板標題列 */}
                <div className="flex items-center gap-3 p-4">
                  <GripVertical className="h-4 w-4 text-muted-foreground/40 shrink-0 cursor-grab" />
                  <FileText className="h-4 w-4 text-primary shrink-0" />

                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <div className="flex items-center gap-2">
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="h-7 text-sm"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveEdit(tmpl.id)
                            if (e.key === "Escape") setEditingId(null)
                          }}
                        />
                        <button onClick={() => saveEdit(tmpl.id)} className="text-green-600 hover:text-green-700">
                          <Check className="h-4 w-4" />
                        </button>
                        <button onClick={() => setEditingId(null)} className="text-muted-foreground hover:text-foreground">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium">{tmpl.name}</p>
                        <Badge variant="secondary" className="text-[10px]">{tmpl.category}</Badge>
                        {tmpl.tags.map((tag) => (
                          <Badge key={tag} variant="outline" className="text-[10px] px-1.5 py-0">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                    {!isEditing && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {tmpl.fields.length} 個欄位・{requiredCount} 必填
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => startEdit(tmpl)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => deleteTemplate(tmpl.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => toggleExpand(tmpl.id)}
                    >
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>

                {/* 欄位展開列表 */}
                {isExpanded && (
                  <>
                    <Separator />
                    <div className="p-4 space-y-2 bg-muted/30">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                          欄位定義
                        </p>
                        <Button variant="outline" size="sm" className="h-6 text-xs gap-1 px-2">
                          <Plus className="h-3 w-3" />
                          新增欄位
                        </Button>
                      </div>

                      {tmpl.fields.map((field: TemplateField, idx: number) => (
                        <div
                          key={field.key}
                          className="flex items-center gap-3 bg-background rounded-md px-3 py-2 text-sm"
                        >
                          <span className="text-muted-foreground w-4 text-xs text-right">{idx + 1}</span>
                          <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40 cursor-grab" />
                          <div className="flex-1 min-w-0">
                            <span className="font-medium">{field.label}</span>
                            {field.placeholder && (
                              <span className="text-muted-foreground ml-2 text-xs truncate">
                                例：{field.placeholder}
                              </span>
                            )}
                          </div>
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                            {fieldTypeLabels[field.type] ?? field.type}
                          </Badge>
                          {field.required ? (
                            <Badge className="text-[10px] px-1.5 py-0 shrink-0">必填</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                              選填
                            </Badge>
                          )}
                          <div className="flex gap-1 shrink-0">
                            <button className="text-muted-foreground hover:text-foreground">
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button className="text-muted-foreground hover:text-destructive">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )
        })}

        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">找不到符合的模板</p>
        )}
      </div>
    </div>
  )
}
