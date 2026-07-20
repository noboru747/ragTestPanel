import { NextRequest, NextResponse } from "next/server"

export const runtime = 'edge'

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params
    const res = await fetch(`${BACKEND}/api/company-vars/project/${projectId}`)
    return NextResponse.json(await res.json(), { status: res.status })
  } catch {
    return NextResponse.json({ vars: [] }, { status: 503 })
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params
    const body = await req.json()
    const res = await fetch(`${BACKEND}/api/company-vars/project/${projectId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    return NextResponse.json(await res.json(), { status: res.status })
  } catch {
    return NextResponse.json({ ok: false, error: "無法連線至後端" }, { status: 503 })
  }
}
