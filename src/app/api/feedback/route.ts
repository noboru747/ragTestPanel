import { NextRequest, NextResponse } from "next/server"

export const runtime = 'edge'

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const res = await fetch(`${BACKEND}/api/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    return NextResponse.json(await res.json(), { status: res.status })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg, backend: BACKEND }, { status: 503 })
  }
}

export async function GET() {
  try {
    const res = await fetch(`${BACKEND}/api/feedback`)
    return NextResponse.json(await res.json(), { status: res.status })
  } catch {
    return NextResponse.json({ feedback: [] }, { status: 503 })
  }
}
