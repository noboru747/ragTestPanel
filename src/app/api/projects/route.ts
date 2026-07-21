import { NextRequest, NextResponse } from "next/server"

export const runtime = 'edge'

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000"
const isLocal = BACKEND.includes("localhost")

export async function GET() {
  try {
    const res = await fetch(`${BACKEND}/api/projects`)
    if (!res.ok) throw new Error(await res.text())
    return NextResponse.json(await res.json())
  } catch {
    if (isLocal) {
      const { mockProjects, mockStats } = await import("@/lib/mock-data")
      return NextResponse.json({ projects: mockProjects, stats: mockStats })
    }
    return NextResponse.json({ projects: [], stats: null })
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  try {
    const res = await fetch(`${BACKEND}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "Backend unavailable" }, { status: 503 })
  }
}
