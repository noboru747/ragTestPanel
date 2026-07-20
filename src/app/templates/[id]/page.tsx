export const runtime = 'edge'

"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  ArrowLeft,
  Plus,
  X,
  ChevronUp,
  ChevronDown,
  Save,
  CheckCircle2,
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

const FIELD_TYPE_LABELS: Record<TemplateField["type"], string> = {
  text: "字串",
  number: "數字",
  date: "日期",
  textarea: "多行文字",
}

export default function TemplateEditPage() {
  const { id } = useParams<{ id: string }>()
  const [template, setTemplate] = useState<Template | null>(null)
  const [name, setName] = useState("")
  const [fields, setFields] = useState<TemplateField[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState("")
  const [loadError, setLoadError] = useState("")
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError("")
    try {
      const res = await fetch(`/api/templates/${id}`)
      if (!res.ok) throw new Error("Not found")
      const data: Template = await res.json()
      setTemplate(data)
      setName(data.name)
      setFields(data.fields)
    } catch {
      setLoadError("無法載入模板資料，請確認模板是否存在")
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  const generateKey = (label: string) =>
    label.toLowerCase().replace(/\s+/g, "_") +
    "_" +
    Date.now().toString(36).slice(-4)

  const addField = () => {
    setFields((f) => [
      ...f,
      { key: generateKey("field"), label: "", type: "text" },
    ])
  }

  const removeField = (idx: number) => {
    setFields((f) => f.filter((_, i) => i !== idx))
  }

  const updateField = (idx: number, update: Partial<TemplateField>) => {
    setFields((f) =>
      f.map((field, i) => (i === idx ? { ...field, ...update } : field))
    )
  }

  const moveField = (idx: number, dir: -1 | 1) => {
    const next = idx + dir
    if (next < 0 || next >= fields.length) return
    setFields((f) => {
      const arr = [...f]
      ;[arr[idx], arr[next]] = [arr[next], arr[idx]]
      return arr
    })
  }

  const save = async () => {
    if (!name.trim()) { setSaveError("模板名稱必填"); return }
    setSaving(true)
    setSaveError("")
    setSaved(false)
    try {
      const res = await fetch(`/api/templates/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), fields }),
      })
      if (res.ok) {
        setSaved(true)
        setTimeout(() => setSaved(false), 2500)
      } else {
        const d = await res.json()
        setSaveError(d.detail ?? d.error ?? "儲存失敗")
      }
    } catch {
      setSaveError("無法連線至伺服器")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="p-6 space-y-5">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-12 w-full" />
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="p-6 space-y-4">
        <Link
          href="/"
          className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          返回儀表板
        </Link>
        <p className="text-sm text-red-500">{loadError}</p>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-5">
      {/* 頂部導覽列 */}
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          返回儀表板
        </Link>
        <Button onClick={save} disabled={saving} className="gap-1.5">
          {saved ? (
            <>
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              已儲存
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              {saving ? "儲存中..." : "儲存變更"}
            </>
          )}
        </Button>
      </div>

      {/* 模板名稱 inline 編輯 */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">模板名稱</label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="模板名稱"
          className="text-base font-semibold h-11"
        />
      </div>

      {/* 欄位管理 */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">欄位管理</h2>
            <Button
              variant="outline"
              size="sm"
              onClick={addField}
              className="gap-1"
            >
              <Plus className="h-3 w-3" />
              新增欄位
            </Button>
          </div>

          {fields.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              尚未定義任何欄位，點擊「新增欄位」開始
            </p>
          ) : (
            <div className="space-y-2">
              {fields.map((field, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 bg-muted/30 rounded-md px-3 py-2"
                >
                  {/* 上移 / 下移 */}
                  <div className="flex flex-col gap-0.5 shrink-0">
                    <button
                      onClick={() => moveField(idx, -1)}
                      disabled={idx === 0}
                      className="text-muted-foreground hover:text-foreground disabled:opacity-25 transition-colors"
                      aria-label="上移"
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => moveField(idx, 1)}
                      disabled={idx === fields.length - 1}
                      className="text-muted-foreground hover:text-foreground disabled:opacity-25 transition-colors"
                      aria-label="下移"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* 欄位名稱輸入 */}
                  <Input
                    value={field.label}
                    onChange={(e) => updateField(idx, { label: e.target.value })}
                    placeholder="欄位名稱"
                    className="flex-1 h-8 text-sm"
                  />

                  {/* 類型選擇 */}
                  <select
                    value={field.type}
                    onChange={(e) =>
                      updateField(idx, {
                        type: e.target.value as TemplateField["type"],
                      })
                    }
                    className="h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none shrink-0"
                  >
                    {(
                      Object.keys(FIELD_TYPE_LABELS) as TemplateField["type"][]
                    ).map((t) => (
                      <option key={t} value={t}>
                        {FIELD_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>

                  {/* 刪除欄位 */}
                  <button
                    onClick={() => removeField(idx)}
                    className="text-muted-foreground hover:text-destructive shrink-0 transition-colors"
                    aria-label="刪除欄位"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {saveError && <p className="text-sm text-red-500">{saveError}</p>}

      {/* 模板元資訊 */}
      {template && (
        <p className="text-xs text-muted-foreground">
          建立於 {new Date(template.created_at).toLocaleString("zh-TW")}
          &nbsp;·&nbsp;
          最後更新 {new Date(template.updated_at).toLocaleString("zh-TW")}
        </p>
      )}
    </div>
  )
}
