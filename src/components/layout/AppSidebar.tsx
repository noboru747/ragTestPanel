"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  MessageSquareText,
  Upload,
  GitBranch,
  BookOpen,
  FileText,
  MessageSquarePlus,
  ClipboardList,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { useState } from "react"
import { FeedbackModal } from "@/components/layout/FeedbackModal"

const SHOW_OCR = process.env.NEXT_PUBLIC_SHOW_OCR === "true"
const IS_DEV = process.env.NODE_ENV === "development"

const navItems = [
  { href: "/", icon: LayoutDashboard, label: "儀表板" },
  { href: "/query", icon: MessageSquareText, label: "知識查詢" },
  { href: "/generate", icon: FileText, label: "生成文件" },
  ...(SHOW_OCR ? [{ href: "/ocr", icon: Upload, label: "OCR 入庫", local: true }] : []),
  { href: "/git", icon: GitBranch, label: "Git 整合" },
]

export function AppSidebar() {
  const pathname = usePathname()
  const [feedbackOpen, setFeedbackOpen] = useState(false)

  return (
    <>
      <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />

      <aside className="flex h-screen w-56 flex-col border-r bg-sidebar">
        <div className="flex h-14 items-center gap-2 border-b px-4">
          <BookOpen className="h-5 w-5 text-primary" />
          <span className="font-semibold text-sm">PM 知識管理</span>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {navItems.map(({ href, icon: Icon, label, local }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href)
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="flex-1">{label}</span>
                {local && (
                  <Badge variant="outline" className="text-[10px] px-1 py-0">
                    本地
                  </Badge>
                )}
              </Link>
            )
          })}
        </nav>

        <div className="border-t p-3 space-y-1">
          {/* 意見回饋 */}
          <button
            onClick={() => setFeedbackOpen(true)}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <MessageSquarePlus className="h-4 w-4 shrink-0" />
            <span>意見回饋</span>
          </button>

          {/* Dev-only: 回饋管理 */}
          {IS_DEV && (
            <Link
              href="/feedback-admin"
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                pathname === "/feedback-admin"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <ClipboardList className="h-4 w-4 shrink-0" />
              <span className="flex-1">回饋管理</span>
              <Badge variant="outline" className="text-[10px] px-1 py-0">dev</Badge>
            </Link>
          )}

          <p className="text-[11px] text-muted-foreground text-center pt-1">
            Powered by Ollama + pgvector
          </p>
        </div>
      </aside>
    </>
  )
}
