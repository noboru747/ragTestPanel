import { NextResponse } from "next/server"
import { createPdfSession } from "@/lib/pdf-sessions"

export async function POST(req: Request) {
  const body = await req.json()
  const { images, pageNumPos, showBlankAfterToc, ...proposalData } = body

  const token = createPdfSession({
    proposalData,
    images: images ?? [],
    pageNumPos: pageNumPos ?? "center",
    showBlankAfterToc: showBlankAfterToc ?? false,
  })

  const { chromium } = await import("playwright")
  const browser = await chromium.launch().catch((err: Error) => {
    throw new Error(`Playwright launch failed: ${err.message}`)
  })
  try {
    const page = await browser.newPage()
    // 讓 Playwright 以 print media 渲染（讓 @media print 的 CSS 生效）
    await page.emulateMedia({ media: "print" })
    const baseUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3001"
    await page.goto(`${baseUrl}/generate/preview?token=${token}`, {
      waitUntil: "networkidle",
    })
    // 等 ProposalDocument 渲染完並設好 ready 標記
    await page.waitForSelector('[data-pdf-ready="1"]', { timeout: 30_000 })

    const pdfBuffer = await page.pdf({
      format: "A4",
      margin: { top: "2cm", right: "2.5cm", bottom: "2.5cm", left: "2.5cm" },
      printBackground: true,
    })
    const pdf = new Uint8Array(pdfBuffer)

    return new NextResponse(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline; filename=proposal.pdf",
      },
    })
  } catch (err) {
    console.error("[pdf/route] PDF generation error:", err)
    return new NextResponse(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    )
  } finally {
    await browser.close()
  }
}
