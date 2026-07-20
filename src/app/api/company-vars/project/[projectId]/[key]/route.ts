import { NextRequest, NextResponse } from "next/server"

export const runtime = 'edge'

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000"

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string; key: string }> }
) {
  try {
    const { projectId, key } = await params
    const res = await fetch(
      `${BACKEND}/api/company-vars/project/${projectId}/${encodeURIComponent(key)}`,
      { method: "DELETE" }
    )
    return NextResponse.json(await res.json(), { status: res.status })
  } catch {
    return NextResponse.json({ ok: false, error: "無法連線至後端" }, { status: 503 })
  }
}
