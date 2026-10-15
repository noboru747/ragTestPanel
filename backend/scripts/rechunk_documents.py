"""
從 documents.content 重新切段 + 算 embedding（不需原檔）。依序處理、不併發。
在 backend 容器內執行（使用容器的 DATABASE_URL / provider 設定）：

  python scripts/rechunk_documents.py --all --dry-run
  python scripts/rechunk_documents.py --project proj-111--mv60s3fa
  python scripts/rechunk_documents.py --all                      # 估算超過 --max-points 會拒絕執行

對 rga_km（Ollama，本機運算不耗點）執行時覆寫環境變數，例如：
  env DATABASE_URL=postgresql://rga_user:rga_pass@postgres:5432/rga_km EMBED_PROVIDER=ollama \\
      LLM_PROVIDER=ollama VISION_PROVIDER=ollama EMBED_MAX_CHARS=1500 python scripts/rechunk_documents.py --all

dry-run 輸出：每專案文件數、段數、送 embedding 總字數、估計 tokens（中文 0.79 token/字）、估計點數。
正式執行：壓縮 documents.content → 切段 → embedding → 寫 document_chunks；documents.embedding 保留不動。
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text as sql  # noqa: E402

from config import settings  # noqa: E402
from services.db_service import AsyncSessionLocal  # noqa: E402
from services.indexer import embed_chunks, prepare, rechunk_existing  # noqa: E402
from services.usage import flush_usage, set_usage_project  # noqa: E402

TOKENS_PER_CHAR = 0.79


def _is_platform() -> bool:
    return (settings.embed_provider or "").strip().lower() == "openai"


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--project", action="append", help="可重複指定")
    g.add_argument("--all", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--skip-done", action="store_true", help="略過已有 chunks 的文件（中斷後續跑用）")
    ap.add_argument("--max-points", type=float, default=15.0, help="平台估算點數上限，超過拒絕執行")
    args = ap.parse_args()

    db_name = settings.database_url.rsplit("/", 1)[-1]
    platform = _is_platform()
    tpp = settings.usage_tokens_per_point
    print(f"DB={db_name} embed_provider={settings.embed_provider} model="
          f"{settings.openai_embed_model if platform else settings.embed_model} embed_max_chars={settings.embed_max_chars}")

    async with AsyncSessionLocal() as db:
        where = "" if args.all else "WHERE d.project_id = ANY(:pids)"
        params = {} if args.all else {"pids": args.project}
        docs = (await db.execute(sql(f"""
            SELECT d.id, d.project_id, d.filename, d.content, d.original_chars,
                   EXISTS (SELECT 1 FROM document_chunks c WHERE c.document_id = d.id) AS done
              FROM documents d {where} ORDER BY d.project_id, d.id
        """), params)).fetchall()
        names = dict((await db.execute(sql("SELECT id, name FROM projects"))).fetchall())

    # ── 試算 ───────────────────────────────────────────────────────────
    plan, stats = [], {}
    for d in docs:
        if args.skip_done and d.done:
            continue
        prep = prepare(d.content or "")
        plan.append((d, prep))
        s = stats.setdefault(d.project_id, {"docs": 0, "chunks": 0, "embed_chars": 0, "raw_chars": 0,
                                            "stored_chars": 0, "truncated": 0})
        s["docs"] += 1
        s["chunks"] += len(prep.chunks)
        s["embed_chars"] += prep.embed_chars
        s["raw_chars"] += len(d.content or "")
        s["stored_chars"] += len(prep.content)
        s["truncated"] += int(prep.truncated)

    tot = {k: sum(s[k] for s in stats.values()) for k in ("docs", "chunks", "embed_chars", "raw_chars", "stored_chars", "truncated")}
    print(f"\n{'專案':<28} {'名稱':<14} {'文件':>5} {'段數':>6} {'原字數':>10} {'壓縮後':>9} {'embed字數':>9} {'估tokens':>9} {'估點數':>7} 截斷")
    for pid, s in stats.items():
        tok = s["embed_chars"] * TOKENS_PER_CHAR
        print(f"{pid:<28} {str(names.get(pid, ''))[:12]:<14} {s['docs']:>5} {s['chunks']:>6} {s['raw_chars']:>10} "
              f"{s['stored_chars']:>9} {s['embed_chars']:>9} {tok:>9.0f} {tok / tpp if platform else 0:>7.2f} {s['truncated']}")
    tok = tot["embed_chars"] * TOKENS_PER_CHAR
    points = tok / tpp if platform else 0.0
    print(f"{'合計':<28} {'':<14} {tot['docs']:>5} {tot['chunks']:>6} {tot['raw_chars']:>10} {tot['stored_chars']:>9} "
          f"{tot['embed_chars']:>9} {tok:>9.0f} {points:>7.2f} {tot['truncated']}")
    calls = sum(-(-len(p.chunks) // settings.embed_batch_size) for _, p in plan) if platform else tot["chunks"]
    print(f"預計 embedding 呼叫 {calls} 次（{'平台批次 ' + str(settings.embed_batch_size) + ' 段/次' if platform else '本機 Ollama 逐段，不計點'}）")

    if args.dry_run:
        return 0
    if platform and points > args.max_points:
        print(f"\n估算 {points:.2f} 點 > 上限 {args.max_points} 點，停止（未執行）。")
        return 2

    # ── 正式執行（依序）───────────────────────────────────────────────
    t_all = time.perf_counter()
    ok = fail = 0
    for i, (d, prep) in enumerate(plan, 1):
        set_usage_project(d.project_id)
        t0 = time.perf_counter()
        try:
            embeddings = await embed_chunks(prep) if prep.chunks else []
            async with AsyncSessionLocal() as db:
                await rechunk_existing(db, d.id, d.project_id, d.content or "", d.original_chars, prep, embeddings)
                await db.commit()
            ok += 1
            status = "ok"
        except Exception as exc:  # noqa: BLE001
            fail += 1
            status = f"FAIL {type(exc).__name__}: {str(exc)[:150]}"
        if status != "ok" or i % 20 == 0 or len(prep.chunks) > 50:
            print(f"[{i:>4}/{len(plan)}] {d.project_id} {d.filename[:40]} 段數={len(prep.chunks)} "
                  f"{time.perf_counter() - t0:.1f}s {status}", flush=True)
    await flush_usage()
    print(f"\n完成：成功 {ok}、失敗 {fail}，耗時 {time.perf_counter() - t_all:.1f}s")
    return 0 if not fail else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
