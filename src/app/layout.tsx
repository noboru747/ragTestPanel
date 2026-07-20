import type { Metadata } from "next"
import "./globals.css"
import { AppSidebar } from "@/components/layout/AppSidebar"
import { TooltipProvider } from "@/components/ui/tooltip"

export const runtime = 'edge'

export const metadata: Metadata = {
  title: "PM 知識管理系統",
  description: "RAG + KM 專案文件管理平台",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW">
      <body>
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
