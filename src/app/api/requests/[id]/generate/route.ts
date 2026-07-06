import { NextRequest, NextResponse } from "next/server"

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000"

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const res = await fetch(`${BACKEND}/api/requests/${id}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(180_000),
    })
    if (!res.ok) {
      const err = await res.text()
      return NextResponse.json({ error: `後端錯誤：${err}` }, { status: 502 })
    }
    return NextResponse.json(await res.json())
  } catch {
    return NextResponse.json({ error: "無法連線至後端或生成逾時" }, { status: 503 })
  }
}
