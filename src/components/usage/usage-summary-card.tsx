"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { ArrowRight, Gauge, RefreshCw } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { QuotaMeter } from "@/components/usage/quota-meter"
import { fetchJson } from "@/lib/backend-fetch"
import { formatCompact, formatInt, normalizeSummary, type UsageSummary } from "@/lib/usage"

const SUMMARY_URL = "/api/usage/summary?days=7"

/** 首頁「AI 用量」小卡：剩餘點數＋近 7 天 tokens，連到 /usage */
export function UsageSummaryCard() {
  const [data, setData] = useState<UsageSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  const apply = useCallback(({ data: d, error: err }: { data: unknown; error: string | null }) => {
    if (err) {
      setError(err)
      setData(null)
    } else {
      setError(null)
      setData(normalizeSummary(d))
    }
  }, [])

  useEffect(() => {
    fetchJson<unknown>(SUMMARY_URL).then(apply)
  }, [apply])

  const retry = () => {
    setError(null)
    fetchJson<unknown>(SUMMARY_URL).then(apply)
  }

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Gauge className="h-4 w-4 text-primary" />
          AI 用量
        </CardTitle>
        <Link href="/usage" className="text-xs text-primary hover:underline inline-flex items-center gap-0.5">
          查看詳情
          <ArrowRight className="h-3 w-3" />
        </Link>
      </CardHeader>
      <CardContent>
        {error ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="flex-1 truncate" title={error}>無法載入用量資料</span>
            <button onClick={retry} className="inline-flex items-center gap-1 hover:text-foreground">
              <RefreshCw className="h-3 w-3" />
              重試
            </button>
          </div>
        ) : !data ? (
          <div className="grid gap-4 sm:grid-cols-[1fr_auto] items-end" role="status" aria-label="用量載入中…">
            <div className="space-y-2">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-2 w-full" />
            </div>
            <Skeleton className="h-10 w-28" />
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-[1fr_auto] items-end">
            <div>
              <p className="text-xs text-muted-foreground mb-1">剩餘點數</p>
              <QuotaMeter quota={data.quota} size="sm" />
            </div>
            <div className="flex gap-6 sm:text-right">
              <div>
                <p className="text-xs text-muted-foreground">本週 tokens</p>
                <p className="text-xl font-semibold">{formatCompact(data.totals.total_tokens)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">本週呼叫</p>
                <p className="text-xl font-semibold">{formatInt(data.totals.calls)}</p>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
