"""
小型檢索評估（只用 embedding，不呼叫 LLM 生成）。在 backend 容器內執行：
  python scripts/eval_retrieval.py --project proj-111--mv60s3fa

比較：
  舊：documents 層（documents.embedding × 0.7 + ts_rank('simple') × 0.3），上下文 = 每份文件前 1500 字
  新：document_chunks 混合檢索（向量 + 中文二元組關鍵字）
命中判定：
  文件命中 = top-5 內出現預期文件
  段落命中 = 舊：預期文件的前 1500 字含答案錨點；新：top-5 中預期文件的某段含答案錨點
  （錨點比對前雙方都去除空白；輸出只列檔名與段號，不印內容）
另比較關鍵字方案（pg_trgm vs 中文二元組）：以 ILIKE 子字串命中為基準計算召回 / 精確度
（pg_trgm 於交易內暫時 CREATE EXTENSION，結束後 ROLLBACK，不留痕跡）。
"""
from __future__ import annotations

import argparse
import asyncio
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text as sql  # noqa: E402

from services.db_service import AsyncSessionLocal  # noqa: E402
from services.indexer import vec_literal  # noqa: E402
from services.keywords import build_tsquery  # noqa: E402
from services.ollama_service import ollama  # noqa: E402
from services.retrieval import search_chunks  # noqa: E402
from services.usage import flush_usage, set_usage_project  # noqa: E402

# (問題, 預期檔名關鍵字（任一）, 答案錨點（任一，去空白比對）)
QUESTIONS = [
    ("駐點人員每天的服務時間是幾點到幾點？", ["建議書徵求文件"], ["下午1時30分", "8時30分"]),
    ("履約保證金金額是多少？", ["投標須知"], ["250,000元"]),
    ("履約保證金什麼時候發還？", ["勞務採購契約"], ["無待解決事項後30日內發還"]),
    ("本案的採購預算金額是多少？", ["投標須知"], ["2,520,000"]),
    ("駐點人員加班可以申請補休嗎？每月上限幾小時？", ["勞務採購契約", "建議書徵求文件"], ["16小時內得"]),
    ("勞務人員請假要走什麼程序？", ["需求說明書"], ["未辦理請假手續者以曠職論"]),
    ("評選項目中專案整體熟悉度的配分是多少？", ["評選須知"], ["專案整體熟悉度"]),
    ("違反資訊安全規定會依哪一條罰則處罰？", ["勞務採購契約"], ["第14條罰則"]),
    ("得標廠商要替勞務人員投保哪些保險？", ["需求說明書"], ["投保勞工保險"]),
    ("派駐工程師需要具備哪些基本資格？", ["建議書徵求文件", "需求說明書"], ["一年以上個人電腦暨週邊", "資格條件如下"]),
]
KEYWORD_PROBES = ["罰則", "保密", "駐點人員", "契約金額", "CW11105", "履約保證金", "教育訓練"]


def _nows(s: str) -> str:
    return re.sub(r"\s+", "", s or "")


def _file_ok(fn: str, keys: list[str]) -> bool:
    return any(k in fn for k in keys)


def _anchor_ok(content: str, anchors: list[str]) -> bool:
    c = _nows(content)
    return any(_nows(a) in c for a in anchors)


async def old_search(db, emb, q, pid, k=5):
    return (await db.execute(sql("""
        SELECT filename, content,
               (1 - (embedding <=> CAST(:e AS vector))) * 0.7
               + COALESCE(ts_rank(content_tsv, plainto_tsquery('simple', :q)), 0) * 0.3 AS relevance
          FROM documents WHERE project_id = :p AND superseded_by IS NULL AND embedding IS NOT NULL
         ORDER BY relevance DESC LIMIT :k
    """), {"e": vec_literal(emb), "q": q, "p": pid, "k": k})).fetchall()


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    args = ap.parse_args()
    pid = args.project
    set_usage_project(pid)

    embs = await ollama.embed_many([q for q, _, _ in QUESTIONS])   # 一次批次呼叫
    old_doc = old_seg = new_doc = new_seg = 0
    print(f"{'#':>2} {'舊:文件':^7} {'舊:段落':^7} {'新:文件':^7} {'新:段落':^7}  新 top-5（檔名…｜段號）")
    async with AsyncSessionLocal() as db:
        for i, ((q, files, anchors), emb) in enumerate(zip(QUESTIONS, embs), 1):
            olds = await old_search(db, emb, q, pid)
            od = any(_file_ok(r.filename, files) for r in olds)
            os_ = any(_file_ok(r.filename, files) and _anchor_ok(r.content[:1500], anchors) for r in olds)
            hits = await search_chunks(db, emb, q, pid, top_k=5)
            nd = any(_file_ok(h.filename, files) for h in hits)
            seg_hits = [h for h in hits if _file_ok(h.filename, files) and _anchor_ok(h.content, anchors)]
            old_doc += od
            old_seg += os_
            new_doc += nd
            new_seg += bool(seg_hits)
            top = "；".join(f"{h.filename[:14]}…｜{h.chunk_index}" + ("✔" if h in seg_hits else "") for h in hits)
            mark = lambda b: "✔" if b else "✘"  # noqa: E731
            print(f"{i:>2} {mark(od):^7} {mark(os_):^7} {mark(nd):^7} {mark(bool(seg_hits)):^7}  {top}")
        n = len(QUESTIONS)
        print(f"\n合計（{n} 題）：舊 文件命中 {old_doc}/{n}、段落命中 {old_seg}/{n}；新 文件命中 {new_doc}/{n}、段落命中 {new_seg}/{n}")

        # ── 關鍵字方案比較 ─────────────────────────────────────────────
        print("\n關鍵字方案（chunks；基準 = ILIKE 子字串命中數）")
        print(f"{'查詢':<10} {'基準':>5} | {'bigram 命中':>10} {'召回':>6} {'精確':>6} | {'trgm(%>) 命中':>12} {'召回':>6} {'精確':>6} | {'trgm word_sim top5 正確':>8}")
        await db.execute(sql("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        for term in KEYWORD_PROBES:
            truth = {r.id for r in (await db.execute(sql(
                "SELECT id FROM document_chunks WHERE project_id = :p AND lower(content) LIKE '%' || lower(:t) || '%'"),
                {"p": pid, "t": term})).fetchall()}
            tsq = build_tsquery(term)
            bg = {r.id for r in (await db.execute(sql(
                "SELECT id FROM document_chunks WHERE project_id = :p AND keywords_tsv @@ to_tsquery('simple', :q)"),
                {"p": pid, "q": tsq})).fetchall()} if tsq else set()
            tg = {r.id for r in (await db.execute(sql(
                "SELECT id FROM document_chunks WHERE project_id = :p AND :t <% content"),
                {"p": pid, "t": term})).fetchall()}
            top = [r.id for r in (await db.execute(sql(
                "SELECT id FROM document_chunks WHERE project_id = :p ORDER BY word_similarity(:t, content) DESC LIMIT 5"),
                {"p": pid, "t": term})).fetchall()]

            def rp(found):
                tp = len(found & truth)
                return (f"{tp / len(truth):.0%}" if truth else "-"), (f"{tp / len(found):.0%}" if found else "-")
            br, bp = rp(bg)
            tr, tp_ = rp(tg)
            print(f"{term:<10} {len(truth):>5} | {len(bg):>10} {br:>6} {bp:>6} | {len(tg):>12} {tr:>6} {tp_:>6} | "
                  f"{sum(1 for x in top if x in truth)}/5")
        await db.rollback()          # 移除暫時建立的 pg_trgm
    await flush_usage()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
