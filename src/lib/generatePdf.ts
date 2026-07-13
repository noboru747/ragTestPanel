import { type ProposalData, type InsertedImage } from "@/components/proposal/ProposalDocument"

export async function printProposalPdf(data: ProposalData, images: InsertedImage[] = []): Promise<void> {
  // 在 user gesture 同步階段先開好視窗，避免 async 後被 popup blocker 攔截
  const win = window.open("", "_blank")
  if (win) {
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>PDF 產生中...</title></head>
<body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#111827;color:#e5e7eb;font-family:sans-serif;">
  <div style="text-align:center;gap:1rem;display:flex;flex-direction:column;align-items:center;">
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83">
        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/>
      </path>
    </svg>
    <div style="font-size:1.1rem;font-weight:500;">PDF 產生中，請稍候...</div>
    <div style="font-size:0.85rem;color:#9ca3af;">Chromium 正在渲染文件</div>
  </div>
</body></html>`)
    win.document.close()
  }

  const res = await fetch("/api/generate/pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...data, images }),
  })
  if (!res.ok) {
    win?.close()
    throw new Error("PDF generation failed")
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)

  if (win) {
    win.location.href = url
  } else {
    // fallback：popup 被攔時改成下載
    const a = document.createElement("a")
    a.href = url
    a.download = "proposal.pdf"
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export async function downloadProposalPdf(data: ProposalData, images: InsertedImage[] = []): Promise<void> {
  const res = await fetch("/api/generate/pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...data, images }),
  })
  if (!res.ok) throw new Error("PDF generation failed")
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `${(data as unknown as Record<string, string>)["案號"] || "proposal"}.pdf`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
