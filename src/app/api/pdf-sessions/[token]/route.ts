import { NextResponse } from "next/server"
import { getPdfSession } from "@/lib/pdf-sessions"

export const runtime = 'edge'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const data = getPdfSession(token)
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json(data)
}
