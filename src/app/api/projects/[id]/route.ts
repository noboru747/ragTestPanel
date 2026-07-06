import { NextRequest, NextResponse } from "next/server"

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000"
const isLocal = BACKEND.includes("localhost")

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    // 從後端取專案資訊 + 該專案的文件列表
    const [projRes, docsRes] = await Promise.all([
      fetch(`${BACKEND}/api/projects`, { cache: "no-store" }),
      fetch(`${BACKEND}/api/documents/list?project_id=${id}`, { cache: "no-store" }),
    ])
    const { projects } = await projRes.json()
    const project = projects.find((p: { id: string }) => p.id === id)
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const docsData = docsRes.ok ? await docsRes.json() : { documents: [] }
    return NextResponse.json({ project, documents: docsData.documents ?? [] })
  } catch {
    if (isLocal) {
      const { mockProjects, mockDocuments } = await import("@/lib/mock-data")
      const project = mockProjects.find((p) => p.id === id)
      if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 })
      return NextResponse.json({ project, documents: mockDocuments[id] ?? [] })
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json()
  try {
    const res = await fetch(`${BACKEND}/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    return NextResponse.json(await res.json(), { status: res.status })
  } catch {
    return NextResponse.json({ error: "Backend unavailable" }, { status: 503 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const res = await fetch(`${BACKEND}/api/projects/${id}`, { method: "DELETE" })
    return NextResponse.json(await res.json(), { status: res.status })
  } catch {
    return NextResponse.json({ error: "Backend unavailable" }, { status: 503 })
  }
}
