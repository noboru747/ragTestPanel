import { NextRequest, NextResponse } from "next/server"

export const runtime = 'edge'
import { mockGitRepo } from "@/lib/mock-data"

export async function POST(req: NextRequest) {
  const { url } = await req.json()
  await new Promise((r) => setTimeout(r, 1500))

  if (!url || !url.startsWith("http")) {
    return NextResponse.json({ error: "?⊥???Git URL" }, { status: 400 })
  }

  return NextResponse.json({
    success: true,
    repo: { ...mockGitRepo, url },
  })
}

export async function GET() {
  await new Promise((r) => setTimeout(r, 200))
  return NextResponse.json({ repo: mockGitRepo })
}
