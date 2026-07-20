import { NextRequest, NextResponse } from "next/server"

export const runtime = 'edge'

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000"

export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const file = formData.get("file") as File | null

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 })
  }

  // 送到 Python backend 提取文字
  const backendForm = new FormData()
  backendForm.append("file", file, file.name)

  let extractedText = ""
  let method = "unknown"
  let error: string | null = null

  try {
    const ocrRes = await fetch(`${BACKEND}/api/ocr/extract`, {
      method: "POST",
      body: backendForm,
    })

    if (!ocrRes.ok) {
      const errBody = await ocrRes.text()
      error = `OCR failed: ${errBody}`
    } else {
      const ocrData = await ocrRes.json()
      extractedText = ocrData.text ?? ""
      method = ocrData.method ?? "unknown"
    }
  } catch (e) {
    error = `Backend unreachable: ${e}`
  }

  if (error) {
    return NextResponse.json({ success: false, error }, { status: 502 })
  }

  // 如果有 project_id，順便入庫向量索引
  const projectId = formData.get("project_id") as string | null
  if (projectId && extractedText) {
    try {
      await fetch(`${BACKEND}/api/documents/index`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          filename: file.name,
          text: extractedText,
        }),
      })
    } catch {
      // 入庫失敗不影響 OCR 結果回傳
    }
  }

  return NextResponse.json({
    success: true,
    filename: file.name,
    text: extractedText,
    method,
    char_count: extractedText.length,
  })
}
