"use client"

import { Suspense, useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import ProposalDocument, {
  type ProposalData,
  type InsertedImage,
} from "@/components/proposal/ProposalDocument"

function PreviewContent() {
  const searchParams = useSearchParams()
  const [proposalData, setProposalData] = useState<ProposalData | null>(null)
  const [images, setImages] = useState<InsertedImage[]>([])
  const [editMode, setEditMode] = useState(false)
  const docRef = useRef<HTMLDivElement>(null)

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
        [contenteditable="true"] { outline: 2px dashed #93c5fd; outline-offset: 2px; border-radius: 2px; }
        [contenteditable="true"]:focus { outline: 2px solid #3b82f6; background: #eff6ff; }
      `}</style>

      {/* 頂部 Nav */}
      <div className="no-print fixed top-0 left-0 right-0 z-50 bg-gray-900 text-white px-5 py-2.5 flex items-center justify-between shadow">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">建議書預覽</span>
          {editMode && (
            <span className="text-xs bg-blue-500 px-2 py-0.5 rounded">編輯模式</span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setEditMode(v => !v)}
            className={`text-sm px-4 py-1.5 rounded transition border ${
              editMode
                ? "bg-blue-500 border-blue-400 text-white"
                : "border-gray-600 text-gray-300 hover:border-gray-400 hover:text-white"
            }`}
          >
            {editMode ? "完成編輯" : "編輯文案"}
          </button>
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

      {editMode && (
        <div className="no-print fixed top-11 left-0 right-0 z-40 bg-blue-50 border-b border-blue-200 text-blue-700 text-xs px-5 py-2">
          點擊任意文字即可直接編輯，修改後直接「列印/儲存PDF」即可輸出修改版本。
        </div>
      )}

      {/* 深色底 + 白紙居中，左右各約 20% */}
      <div
        className="min-h-screen bg-gray-700"
        style={{ paddingTop: editMode ? "5.5rem" : "3rem", paddingBottom: "3rem", paddingLeft: "20%", paddingRight: "20%" }}
      >
        <div
          ref={docRef}
          className="bg-white shadow-2xl"
          contentEditable={editMode}
          suppressContentEditableWarning
        >
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
