import { NextRequest, NextResponse } from "next/server"

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const qs = searchParams.toString()
  try {
    const res = await fetch(`${BACKEND}/api/documents/list${qs ? `?${qs}` : ""}`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return NextResponse.json({ documents: [] }, { status: 502 })
    return NextResponse.json(await res.json())
  } catch {
    return NextResponse.json({ documents: [] })
  }
}
