type SessionData = {
  proposalData: Record<string, unknown>
  images: unknown[]
  pageNumPos: string
  showBlankAfterToc: boolean
}

type Store = Map<string, { data: SessionData; expiresAt: number }>

// 掛在 globalThis 避免 Next.js HMR 重載 module 時 Map 被清空
const g = globalThis as typeof globalThis & { __pdfSessions?: Store }
if (!g.__pdfSessions) g.__pdfSessions = new Map()
const sessions: Store = g.__pdfSessions

export function createPdfSession(data: SessionData): string {
  const token = crypto.randomUUID()
  sessions.set(token, { data, expiresAt: Date.now() + 120_000 })
  for (const [k, v] of sessions) {
    if (v.expiresAt < Date.now()) sessions.delete(k)
  }
  return token
}

export function getPdfSession(token: string): SessionData | null {
  const entry = sessions.get(token)
  if (!entry || entry.expiresAt < Date.now()) {
    sessions.delete(token)
    return null
  }
  sessions.delete(token)
  return entry.data
}
