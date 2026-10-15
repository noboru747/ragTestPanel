"""
用量儀表板：GET /api/usage/summary?days=30&project_id=

- 資料來源 llm_usage（每次 chat / embed / vision 呼叫一筆，啟用後才開始累計，不回補）
- points 只計 provider=openai（平台）的 tokens：points = total_tokens / USAGE_TOKENS_PER_POINT
- quota.points_used 依 USAGE_PERIOD_START / USAGE_PERIOD_END（未設則全部期間），不受 days / project_id 影響
- totals / by_day / by_model / by_operation / by_project / recent 依 days（與 project_id）篩選
"""
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from services.db_service import get_db

router = APIRouter()

PLATFORM = "openai"


def _parse_date(s: str, name: str) -> date | None:
    s = (s or "").strip()
    if not s:
        return None
    try:
        return date.fromisoformat(s[:10])
    except ValueError:
        raise HTTPException(status_code=500, detail=f"{name} 不是 ISO 日期：{s}")


def _points(tokens) -> float:
    tpp = max(1, settings.usage_tokens_per_point)
    return round(float(tokens or 0) / tpp, 4)


@router.get("/summary")
async def usage_summary(
    days: int = Query(30, ge=1, le=3650),
    project_id: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    since = datetime.now(timezone.utc) - timedelta(days=days)
    pid = (project_id or "").strip() or None
    where = "u.created_at >= :since" + (" AND u.project_id = :pid" if pid else "")
    params: dict = {"since": since, "platform": PLATFORM, **({"pid": pid} if pid else {})}

    # ── quota（本期，全部專案）──────────────────────────────────────
    ps = _parse_date(settings.usage_period_start, "USAGE_PERIOD_START")
    pe = _parse_date(settings.usage_period_end, "USAGE_PERIOD_END")
    qwhere, qparams = ["provider = :platform"], {"platform": PLATFORM}
    if ps:
        qwhere.append("created_at >= :ps")
        qparams["ps"] = datetime.combine(ps, datetime.min.time(), tzinfo=timezone.utc)
    if pe:
        qwhere.append("created_at < :pe")
        qparams["pe"] = datetime.combine(pe + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
    used_tokens = (await db.execute(
        text(f"SELECT COALESCE(sum(total_tokens), 0) FROM llm_usage WHERE {' AND '.join(qwhere)}"), qparams,
    )).scalar()
    points_used = _points(used_tokens)
    quota = {
        "points_total": settings.usage_quota_points,
        "tokens_per_point": settings.usage_tokens_per_point,
        "points_used": points_used,
        "points_remaining": round(settings.usage_quota_points - points_used, 4),
        "period_start": ps.isoformat() if ps else None,
        "period_end": pe.isoformat() if pe else None,
        "provider": PLATFORM,
    }

    plat_tokens = "COALESCE(sum(u.total_tokens) FILTER (WHERE u.provider = :platform), 0)"

    t = (await db.execute(text(f"""
        SELECT count(*) AS calls,
               COALESCE(sum(u.prompt_tokens), 0) AS prompt_tokens,
               COALESCE(sum(u.completion_tokens), 0) AS completion_tokens,
               COALESCE(sum(u.total_tokens), 0) AS total_tokens,
               {plat_tokens} AS platform_tokens,
               count(*) FILTER (WHERE NOT u.success) AS failed_calls,
               count(*) FILTER (WHERE u.estimated) AS estimated_calls
          FROM llm_usage u WHERE {where}
    """), params)).one()
    totals = {
        "calls": t.calls, "prompt_tokens": int(t.prompt_tokens), "completion_tokens": int(t.completion_tokens),
        "total_tokens": int(t.total_tokens), "points": _points(t.platform_tokens),
        "failed_calls": t.failed_calls, "estimated_calls": t.estimated_calls,
    }

    by_day = [
        {"date": r.d.isoformat(), "calls": r.calls, "total_tokens": int(r.total_tokens), "points": _points(r.pt)}
        for r in (await db.execute(text(f"""
            SELECT (u.created_at AT TIME ZONE 'Asia/Taipei')::date AS d, count(*) AS calls,
                   COALESCE(sum(u.total_tokens), 0) AS total_tokens, {plat_tokens} AS pt
              FROM llm_usage u WHERE {where} GROUP BY 1 ORDER BY 1
        """), params)).fetchall()
    ]

    by_model = [
        {"provider": r.provider, "model": r.model, "operation": r.operation, "calls": r.calls,
         "total_tokens": int(r.total_tokens), "avg_latency_ms": round(float(r.avg_latency or 0), 1)}
        for r in (await db.execute(text(f"""
            SELECT u.provider, u.model, u.operation, count(*) AS calls,
                   COALESCE(sum(u.total_tokens), 0) AS total_tokens, avg(u.latency_ms) AS avg_latency
              FROM llm_usage u WHERE {where} GROUP BY 1, 2, 3 ORDER BY total_tokens DESC
        """), params)).fetchall()
    ]

    by_operation = [
        {"operation": r.operation, "calls": r.calls, "total_tokens": int(r.total_tokens)}
        for r in (await db.execute(text(f"""
            SELECT u.operation, count(*) AS calls, COALESCE(sum(u.total_tokens), 0) AS total_tokens
              FROM llm_usage u WHERE {where} GROUP BY 1 ORDER BY total_tokens DESC
        """), params)).fetchall()
    ]

    by_project = [
        {"project_id": r.project_id, "project_name": r.name, "calls": r.calls,
         "total_tokens": int(r.total_tokens), "points": _points(r.pt)}
        for r in (await db.execute(text(f"""
            SELECT u.project_id, p.name, count(*) AS calls,
                   COALESCE(sum(u.total_tokens), 0) AS total_tokens, {plat_tokens} AS pt
              FROM llm_usage u LEFT JOIN projects p ON p.id = u.project_id
             WHERE {where} GROUP BY 1, 2 ORDER BY total_tokens DESC
        """), params)).fetchall()
    ]

    recent = [
        {"created_at": r.created_at.isoformat(), "provider": r.provider, "model": r.model,
         "operation": r.operation, "project_id": r.project_id, "project_name": r.name,
         "total_tokens": r.total_tokens, "latency_ms": r.latency_ms, "success": r.success,
         "error_code": r.error_code, "estimated": r.estimated}
        for r in (await db.execute(text(f"""
            SELECT u.created_at, u.provider, u.model, u.operation, u.project_id, p.name, u.total_tokens,
                   u.latency_ms, u.success, u.error_code, u.estimated
              FROM llm_usage u LEFT JOIN projects p ON p.id = u.project_id
             WHERE {where} ORDER BY u.created_at DESC LIMIT 50
        """), params)).fetchall()
    ]

    return {
        "quota": quota, "totals": totals, "by_day": by_day, "by_model": by_model,
        "by_operation": by_operation, "by_project": by_project, "recent": recent,
    }
