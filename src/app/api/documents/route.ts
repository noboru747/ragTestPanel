import { NextRequest, NextResponse } from "next/server"

export const runtime = 'edge'

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const qs = searchParams.toString()
  try {
    const res = await fetch(`${BACKEND}/api/documents/list${qs ? `?${qs}` : ""}`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      return NextResponse.json(
        { error: "後端回應錯誤", detail: `HTTP ${res.status}: ${await res.text()}`, documents: [] },
        { status: 502 }
      )
    }
    return NextResponse.json(await res.json())
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: "後端連線失敗", detail, documents: [] }, { status: 503 })
  }
}
