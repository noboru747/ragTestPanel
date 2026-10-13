import type { Metadata } from "next"
import "./globals.css"
import { AppSidebar } from "@/components/layout/AppSidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Suspense } from "react"
import { TopProgressBar } from "@/components/loading/top-progress-bar"

export const runtime = 'edge'

export const metadata: Metadata = {
  title: "PM 知識管理系統",
  description: "RAG + KM 專案文件管理平台",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW">
      <body>
        <Suspense fallback={null}>
          <TopProgressBar />
        </Suspense>
        <TooltipProvider>
          <div className="flex h-screen overflow-hidden bg-background">
            <AppSidebar />
            <main className="flex-1 overflow-y-auto">{children}</main>
          </div>
        </TooltipProvider>
      </body>
    </html>
  )
}
