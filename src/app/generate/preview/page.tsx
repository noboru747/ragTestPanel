"use client"

export const runtime = 'edge'

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import ProposalDocument, {
  type ProposalData,
  type InsertedImage,
} from "@/components/proposal/ProposalDocument"
type PageNumPos = 'left' | 'center' | 'right' | 'none'

function pageNumCss(pos: PageNumPos): string {
  if (pos === 'none') return ''
  const placement = pos === 'left' ? 'left' : pos === 'right' ? 'right' : 'center'
  return `
    @page {
      @bottom-${placement} {
        content: "— " counter(page) " —";
        font-size: 9pt;
        color: #9ca3af;
        font-family: serif;
      }
    }
  `
}

function PreviewContent() {
  const searchParams = useSearchParams()
  const [proposalData, setProposalData] = useState<ProposalData | null>(null)
  const [images, setImages] = useState<InsertedImage[]>([])
  const [pageNumPos, setPageNumPos] = useState<PageNumPos>('center')
  const [showBlankAfterToc, setShowBlankAfterToc] = useState(false)
  const handlePrint = () => window.print()

  // token 模式：Playwright 用 server-side session 傳資料（取代 sessionStorage）
  useEffect(() => {
    const token = searchParams.get("token")
    if (!token) return
    fetch(`/api/pdf-sessions/${token}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return
        if (data.proposalData) setProposalData(data.proposalData)
        if (data.images) setImages(data.images)
        if (data.pageNumPos) setPageNumPos(data.pageNumPos)
        if (typeof data.showBlankAfterToc === "boolean") setShowBlankAfterToc(data.showBlankAfterToc)
      })
      .catch(() => {})
  }, [searchParams])

  useEffect(() => {
    const key = searchParams.get("key")
    if (!key) return
    try {
      const raw = sessionStorage.getItem(key)
      if (!raw) return
      const data = JSON.parse(raw)
      if (data.proposalData) setProposalData(data.proposalData)
      if (data.images) setImages(data.images)
      if (data.pageNumPos) setPageNumPos(data.pageNumPos)
      if (typeof data.showBlankAfterToc === 'boolean') setShowBlankAfterToc(data.showBlankAfterToc)
    } catch {}
  }, [searchParams])

  // 注入到 <head> 才能確保列印媒體樣式可靠生效
  useEffect(() => {
    const el = document.createElement('style')
    el.id = '__preview-layout-css'
    el.textContent = `
      /* 預覽頁隱藏側邊欄 */
      aside { display: none !important; }

      /* 螢幕：每個 page 區塊模擬 A4 高度，視覺一致 */
      @media screen {
        .page { min-height: 297mm !important; }
      }

      /* 列印：解除 root layout 截斷，讓完整文件輸出 */
      @media print {
        html, body {
          height: auto !important;
          overflow: visible !important;
          background: white !important;
          margin: 0 !important;
        }
        body > * > div, main {
          height: auto !important;
          overflow: visible !important;
          max-height: none !important;
        }
        .bg-gray-700 { background: white !important; padding: 0 !important; }
        .shadow-2xl  { box-shadow: none !important; }
        .page        { min-height: auto !important; }
        .no-print    { display: none !important; }
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }

        /* 額外補充：解除所有高度限制 */
        .min-h-screen { min-height: auto !important; }
        [class*="min-h-"] { min-height: auto !important; }
        [class*="h-screen"] { height: auto !important; }

        /* 確保所有層級都可以自由流動 */
        html, body, body > *, body > * > *, body > * > * > * {
          height: auto !important;
          max-height: none !important;
          overflow: visible !important;
        }
      }
    `
    document.head.appendChild(el)
    return () => el.remove()
  }, [])

  useEffect(() => {
    if (!proposalData) return
    if (searchParams.get("print") === "1") {
      setTimeout(() => window.print(), 600)
    }
  }, [proposalData, searchParams])

  // Playwright 等待標記：proposalData 設定後 2 秒（等圖片 + ProposalDocument measure 完成）
  useEffect(() => {
    if (!proposalData) return
    const timer = setTimeout(() => {
      document.body.setAttribute("data-pdf-ready", "1")
    }, 4000)
    return () => clearTimeout(timer)
  }, [proposalData])

  if (!proposalData) {
    return (
      <div className="flex items-center justify-center min-h-screen text-gray-400">
        載入中...
      </div>
    )
  }

  return (
    <>
      <style>{`
        /* ── 預覽頁：隱藏側邊欄，讓文件佔滿全寬（螢幕 + 列印通用） ── */
        aside { display: none !important; }

        /* ── 列印樣式 ── */
        @media print {
          .no-print { display: none !important; }

          /* 解除 root layout 的 h-screen / overflow-hidden，讓完整文件輸出 */
          html, body {
            height: auto !important;
            overflow: visible !important;
            background: white !important;
            margin: 0 !important;
          }
          body > * > div, main {
            height: auto !important;
            overflow: visible !important;
            max-height: none !important;
          }

          /* 移除深色背景與 padding */
          .bg-gray-700 {
            background: white !important;
            padding: 0 !important;
          }
          .shadow-2xl { box-shadow: none !important; }

          /* 修正 min-height，讓瀏覽器依 A4 自然斷頁 */
          .page { min-height: auto !important; }

          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }

        @page { size: A4; margin: 2cm 2.5cm 2.5cm; }
        ${pageNumCss(pageNumPos)}
      `}</style>

      {/* 頂部 Nav */}
      <div className="no-print fixed top-0 left-0 right-0 z-50 bg-gray-900 text-white px-5 py-2.5 flex items-center justify-between shadow">
        <span className="text-sm font-medium">建議書預覽</span>
        <div className="flex gap-2">
          <button
            onClick={handlePrint}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-1.5 rounded transition"
          >
            列印 / 儲存 PDF
          </button>
          <button
            onClick={() => window.close()}
            className="text-gray-400 hover:text-white text-sm px-3 py-1.5 rounded transition"
          >
            關閉
          </button>
        </div>
      </div>

      {/* 深色底 + 白紙居中 */}
      <div
        className="min-h-screen bg-gray-700"
        style={{ paddingTop: "3rem", paddingBottom: "3rem", paddingLeft: "20%", paddingRight: "20%" }}
      >
        <div className="bg-white shadow-2xl">
          <ProposalDocument
            data={proposalData}
            images={images}
            editMode={false}
            pageNumPos={pageNumPos}
            showBlankAfterToc={showBlankAfterToc}
          />
        </div>
      </div>
    </>
  )
}

export default function PreviewPage() {
  return (
    <Suspense>
      <PreviewContent />
    </Suspense>
  )
}
