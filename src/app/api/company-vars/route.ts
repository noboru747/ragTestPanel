import { NextRequest, NextResponse } from "next/server"

export const runtime = 'edge'

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000"

export async function GET() {
  try {
    const res = await fetch(`${BACKEND}/api/company-vars`)
    return NextResponse.json(await res.json(), { status: res.status })
  } catch {
    return NextResponse.json({ vars: [] }, { status: 503 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const res = await fetch(`${BACKEND}/api/company-vars`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    return NextResponse.json(await res.json(), { status: res.status })
  } catch {
    return NextResponse.json({ ok: false, error: "無法連線至後端" }, { status: 503 })
  }
}
