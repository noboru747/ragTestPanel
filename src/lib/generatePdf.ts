async function getHtmlForPdf(element: HTMLElement): Promise<string> {
  // Inline all <style> tags from document head
  const styles = Array.from(document.querySelectorAll("style"))
    .map((s) => s.outerHTML)
    .join("\n")

  // Fetch and inline any linked stylesheets (same origin)
  const linkTags = Array.from(
    document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')
  )
  const inlinedLinks = await Promise.all(
    linkTags.map(async (link) => {
      try {
        const css = await fetch(link.href).then((r) => r.text())
        return `<style>${css}</style>`
      } catch {
        return ""
      }
    })
  )

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
${styles}
${inlinedLinks.join("\n")}
<style>
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body style="margin:0;padding:0">${element.outerHTML}</body>
</html>`
}

export async function printProposalPdf(element: HTMLElement, filename = "proposal"): Promise<void> {
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
    <div style="font-size:0.85rem;color:#9ca3af;">後端正在渲染文件</div>
  </div>
</body></html>`)
    win.document.close()
  }

  const html = await getHtmlForPdf(element)
  const res = await fetch("/api/generate/pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ html, filename }),
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
    const a = document.createElement("a")
    a.href = url
    a.download = `${filename}.pdf`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export async function downloadProposalPdf(element: HTMLElement, filename = "proposal"): Promise<void> {
  const html = await getHtmlForPdf(element)
  const res = await fetch("/api/generate/pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ html, filename }),
  })
  if (!res.ok) throw new Error("PDF generation failed")
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `${filename}.pdf`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
