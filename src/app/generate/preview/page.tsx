"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import ProposalDocument, {
  type ProposalData,
  type InsertedImage,
} from "@/components/proposal/ProposalDocument"

function PreviewContent() {
  const searchParams = useSearchParams()
  const [proposalData, setProposalData] = useState<ProposalData | null>(null)
  const [images, setImages] = useState<InsertedImage[]>([])

  useEffect(() => {
    const key = searchParams.get("key")
    if (!key) return
    try {
      const raw = sessionStorage.getItem(key)
      if (!raw) return
      const data = JSON.parse(raw)
      if (data.proposalData) setProposalData(data.proposalData)
      if (data.images) setImages(data.images)
    } catch {}
  }, [searchParams])

  useEffect(() => {
    if (!proposalData) return
    if (searchParams.get("print") === "1") {
      setTimeout(() => window.print(), 600)
    }
  }, [proposalData, searchParams])

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
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; margin: 0; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
        @page { size: A4; margin: 2cm 2.5cm; }
      `}</style>

      {/* 頂部 Nav */}
      <div className="no-print fixed top-0 left-0 right-0 z-50 bg-gray-900 text-white px-5 py-2.5 flex items-center justify-between shadow">
        <span className="text-sm font-medium">建議書預覽</span>
        <div className="flex gap-2">
          <button
            onClick={() => window.print()}
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

      {/* 深色底 + 白紙居中，左右各約 20% */}
      <div className="pt-12 min-h-screen bg-gray-700" style={{ padding: "3rem 20%" }}>
        <div className="bg-white shadow-2xl">
          <ProposalDocument data={proposalData} images={images} editMode={false} />
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
