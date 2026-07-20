import { NextRequest, NextResponse } from "next/server"

export const runtime = 'edge'

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000"

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { question, projectId, top_k } = body

  try {
    const res = await fetch(`${BACKEND}/api/query/rag`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        project_id: projectId ?? null,
        top_k: top_k ?? 5,
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      return NextResponse.json(
        { answer: `後端錯誤：${err}`, sources: [] },
        { status: 502 }
      )
    }

    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json(
      {
        answer: "無法連線至後端服務。請確認 Docker 服務正在運行（`docker compose up -d`）。",
        sources: [],
      },
      { status: 503 }
    )
  }
}
