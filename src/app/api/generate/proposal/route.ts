import { NextRequest, NextResponse } from "next/server"

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000"

export async function POST(req: NextRequest) {
  const body = await req.json()
  try {
    const res = await fetch(`${BACKEND}/api/generate/proposal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    })
    if (!res.ok) {
      const err = await res.text()
      return NextResponse.json({ error: `後端錯誤：${err}` }, { status: 502 })
    }
    return NextResponse.json(await res.json())
  } catch {
    return NextResponse.json(
      { error: "無法連線至後端，請確認 Docker 服務運行中。" },
      { status: 503 }
    )
  }
}
