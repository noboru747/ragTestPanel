import { NextRequest, NextResponse } from "next/server"

export const runtime = 'edge'

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    // 從後端取專案資訊 + 該專案的文件列表
    const [projRes, docsRes] = await Promise.all([
      fetch(`${BACKEND}/api/projects`),
      fetch(`${BACKEND}/api/documents/list?project_id=${id}`),
    ])
    if (!projRes.ok) throw new Error(`HTTP ${projRes.status}: ${await projRes.text()}`)
    const { projects } = await projRes.json()
    const project = projects.find((p: { id: string }) => p.id === id)
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const docsData = docsRes.ok ? await docsRes.json() : { documents: [] }
    return NextResponse.json({ project, documents: docsData.documents ?? [] })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: "後端連線失敗", detail }, { status: 503 })
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
  let res: Response
  try {
    res = await fetch(`${BACKEND}/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: "後端連線失敗", detail }, { status: 503 })
  }

  const raw = await res.text()
  let body: unknown = null
  try {
    body = raw ? JSON.parse(raw) : null
  } catch {
    body = null
  }

  if (res.ok) {
    // 成功：完整透傳後端回應 { status, deleted_documents, deleted_mappings } 與狀態碼
    return NextResponse.json(body ?? {}, { status: res.status })
  }

  // 失敗：4xx（如 404 找不到專案）透傳狀態碼；5xx 統一 502
  const b = (body ?? {}) as { detail?: unknown; error?: unknown }
  const detail =
    typeof b.detail === "string" ? b.detail : typeof b.error === "string" ? b.error : raw || `HTTP ${res.status}`
  return NextResponse.json(
    { error: res.status === 404 ? "找不到此專案" : "刪除專案失敗", detail },
    { status: res.status >= 500 ? 502 : res.status }
  )
}
