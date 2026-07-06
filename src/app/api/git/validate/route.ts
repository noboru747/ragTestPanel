import { NextRequest, NextResponse } from "next/server"

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000"

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url") ?? ""
  if (!url) {
    return NextResponse.json({ valid: false, reason: "缺少 url 參數" })
  }
  try {
    const res = await fetch(
      `${BACKEND}/api/git/validate?url=${encodeURIComponent(url)}`,
      { signal: AbortSignal.timeout(15000) }
    )
    return NextResponse.json(await res.json())
  } catch {
    return NextResponse.json({ valid: false, reason: "驗證服務無法連線" })
  }
}
