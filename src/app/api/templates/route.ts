import { NextRequest, NextResponse } from "next/server"

export const runtime = 'edge'

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000"

export async function GET() {
  try {
    const res = await fetch(`${BACKEND}/api/templates`)
    if (!res.ok) throw new Error(await res.text())
    return NextResponse.json(await res.json())
  } catch {
    return NextResponse.json({ templates: [] })
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  try {
    const res = await fetch(`${BACKEND}/api/templates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "Backend unavailable" }, { status: 503 })
  }
}
