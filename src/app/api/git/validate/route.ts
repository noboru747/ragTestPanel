import { NextRequest, NextResponse } from "next/server"

export const runtime = 'edge'

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000"

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url") ?? ""
  if (!url) {
    return NextResponse.json({ valid: false, reason: "蝻箏? url ?" })
  }
  try {
    const res = await fetch(
      `${BACKEND}/api/git/validate?url=${encodeURIComponent(url)}`,
      { signal: AbortSignal.timeout(15000) }
    )
    return NextResponse.json(await res.json())
  } catch {
    return NextResponse.json({ valid: false, reason: "撽????⊥????" })
  }
}
