"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, Loader2, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { fetchJson } from "@/lib/backend-fetch"

export type DeleteProjectResult = {
  status: string
  deleted_documents?: number
  deleted_mappings?: number
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  projectName: string
  /** 頁面已載入的文件數 */
  documentCount: number
  onDeleted: (result: DeleteProjectResult) => void
}

export function DeleteProjectDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
  documentCount,
  onDeleted,
}: Props) {
  const [confirmText, setConfirmText] = useState("")
  const [mappingCount, setMappingCount] = useState<number | null | "loading">("loading")
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 每次開啟時重置並查詢遮罩對照筆數（失敗不阻擋刪除）
  useEffect(() => {
    if (!open) return
    setConfirmText("")
    setError(null)
    setMappingCount("loading")
    let cancelled = false
    fetchJson<{ mappings?: unknown[] }>(
      `/api/mask/mappings?project_id=${encodeURIComponent(projectId)}`
    ).then(({ data, error }) => {
      if (cancelled) return
      setMappingCount(error || !Array.isArray(data?.mappings) ? null : data.mappings.length)
    })
    return () => {
      cancelled = true
    }
  }, [open, projectId])

  const canDelete = confirmText === projectName && !deleting

  const handleDelete = async () => {
    if (!canDelete) return
    setDeleting(true)
    setError(null)
    const { data, error } = await fetchJson<DeleteProjectResult>(
      `/api/projects/${encodeURIComponent(projectId)}`,
      { method: "DELETE" }
    )
    if (error || !data) {
      setError(error ?? "刪除失敗")
      setDeleting(false)
      return
    }
    onDeleted(data)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (deleting) return // 刪除中不可關閉
        onOpenChange(o)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-4 w-4" />
            刪除專案
          </DialogTitle>
          <DialogDescription>
            即將刪除專案「<span className="font-medium text-foreground">{projectName}</span>」，以下資料將一併刪除：
          </DialogDescription>
        </DialogHeader>

        <ul className="text-sm space-y-1 rounded-md border bg-muted/30 px-3 py-2">
          <li className="flex justify-between">
            <span className="text-muted-foreground">文件（含內容與向量）</span>
            <span className="font-medium">{documentCount} 份</span>
          </li>
          <li className="flex justify-between">
            <span className="text-muted-foreground">遮罩對照表</span>
            <span className="font-medium">
              {mappingCount === "loading" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin inline" />
              ) : mappingCount === null ? (
                <span className="text-muted-foreground font-normal">無法取得</span>
              ) : (
                `${mappingCount} 筆`
              )}
            </span>
          </li>
        </ul>

        <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          此操作無法復原。文件內容、向量與遮罩對照表都會從本機資料庫刪除。
        </p>

        <div className="space-y-1.5">
          <label htmlFor="confirm-project-name" className="text-xs text-muted-foreground">
            請輸入完整專案名稱「<span className="font-medium text-foreground">{projectName}</span>」以確認
          </label>
          <Input
            id="confirm-project-name"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleDelete()
            }}
            disabled={deleting}
            autoComplete="off"
            placeholder={projectName}
          />
        </div>

        {error && <p className="text-xs text-destructive break-all">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={deleting}>
            取消
          </Button>
          <Button
            onClick={handleDelete}
            disabled={!canDelete}
            className="gap-1.5 bg-destructive text-white hover:bg-destructive/90"
          >
            {deleting ? (
              <><Loader2 className="h-4 w-4 animate-spin" />刪除中...</>
            ) : (
              <><Trash2 className="h-4 w-4" />確認刪除</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
