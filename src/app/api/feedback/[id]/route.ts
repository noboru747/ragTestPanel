import { NextRequest, NextResponse } from "next/server"

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000"

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const res = await fetch(`${BACKEND}/api/feedback/${id}`, { method: "DELETE" })
    return NextResponse.json(await res.json(), { status: res.status })
  } catch {
    return NextResponse.json({ ok: false, error: "無法連線至後端" }, { status: 503 })
  }
}
