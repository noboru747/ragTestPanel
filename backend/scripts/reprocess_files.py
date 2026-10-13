"""
重跑（重新提取 + 入庫）一批檔案。依序處理、不併發。

用法（主機或容器內皆可，需 httpx）：
  python backend/scripts/reprocess_files.py LIST.txt PROJECT_ID --root ROOT [--mask] [--repair] [--dry-run]
      [--api http://localhost:8000] [--csv out.csv] [--embed-max-chars 6000] [--delete-shells]

- LIST.txt：每行一個檔案路徑（UTF-8；接受 git-bash 形式 /c/... 或 C:\\...）
- 檔名映射：basename 在清單內重複，或 DB 已有同 basename 且內容 ≥ 50 字（可能是別的檔案）
  → 以「相對 ROOT 的路徑」（/ 分隔）當 filename，避免覆蓋；否則沿用 basename（覆蓋同名空殼）
- --delete-shells：以相對路徑入庫成功後，刪除同專案中同 basename、內容 < 50 字的空殼文件
  （透過 docker exec rga_postgres psql，只動 PROJECT_ID）
- --dry-run：只列出計畫；對每個檔案呼叫 /api/ocr/extract（mask=true、repair=false、不帶 project_id
  → 只在本機解析，不呼叫平台、不寫 DB）取得 diagnostics 以預估處理方式
"""
from __future__ import annotations

import argparse
import csv
import os
import re
import subprocess
import sys
import time
from collections import Counter

import httpx

SHELL_MAX_CHARS = 50
DB_CONTAINER = os.getenv("DB_CONTAINER", "rga_postgres")
DB_NAME = os.getenv("DB_NAME", "rga_km_modaone")
DB_USER = os.getenv("DB_USER", "rga_user")


def to_local_path(p: str) -> str:
    p = p.strip().strip('"')
    m = re.match(r"^/([a-zA-Z])/(.*)$", p)
    if m and os.name == "nt":
        return f"{m.group(1).upper()}:/{m.group(2)}"
    return p


def rel_to_root(path: str, root: str) -> str:
    rel = os.path.relpath(path, root)
    return rel.replace("\\", "/")


def fetch_existing(client: httpx.Client, project_id: str) -> dict[str, int]:
    r = client.get("/api/documents/list", params={"project_id": project_id, "limit": 1000})
    r.raise_for_status()
    out = {}
    for d in r.json()["documents"]:
        m = re.match(r"(\d+)", d.get("size", ""))
        out[d["name"]] = int(m.group(1)) if m else 0
    return out


def plan_filenames(paths: list[str], root: str, existing: dict[str, int]) -> list[dict]:
    base_count = Counter(os.path.basename(p) for p in paths)
    plan = []
    for p in paths:
        b = os.path.basename(p)
        rel = rel_to_root(p, root)
        why = ""
        if base_count[b] > 1:
            why = "dup_in_list"
        elif b in existing and existing[b] >= SHELL_MAX_CHARS:
            why = "db_has_content"
        fn = rel if why else b
        shell = b if (why and b in existing and existing[b] < SHELL_MAX_CHARS) else ""
        plan.append({"path": p, "rel": rel, "basename": b, "filename": fn, "rename_reason": why,
                     "overwrites_existing": fn in existing, "shell_basename": shell})
    return plan


def delete_shell(project_id: str, filename: str) -> int:
    def q(s: str) -> str:
        return "'" + s.replace("'", "''") + "'"
    sql = (f"DELETE FROM documents WHERE project_id = {q(project_id)} AND filename = {q(filename)} "
           f"AND length(content) < {SHELL_MAX_CHARS};")
    r = subprocess.run(
        ["docker", "exec", "-i", DB_CONTAINER, "psql", "-U", DB_USER, "-d", DB_NAME, "-At", "-v", "ON_ERROR_STOP=1"],
        input=sql.encode("utf-8"), capture_output=True,
    )
    if r.returncode != 0:
        raise RuntimeError(r.stderr.decode("utf-8", "replace"))
    m = re.search(r"DELETE (\d+)", r.stdout.decode("utf-8", "replace"))
    return int(m.group(1)) if m else 0


def extract(client: httpx.Client, path: str, *, mask: bool, repair: bool, project_id: str) -> tuple[int, dict, float]:
    with open(path, "rb") as f:
        data = f.read()
    form = {"mask": "true" if mask else "false", "repair": "true" if repair else "false"}
    if project_id:
        form["project_id"] = project_id
    t0 = time.perf_counter()
    r = client.post("/api/ocr/extract", files={"file": (os.path.basename(path), data, "application/octet-stream")},
                    data=form)
    ms = (time.perf_counter() - t0) * 1000
    try:
        body = r.json()
    except ValueError:
        body = {"error_code": "http_error", "reason": r.text[:300]}
    return r.status_code, body, ms


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("list_file")
    ap.add_argument("project_id")
    ap.add_argument("--root", required=True)
    ap.add_argument("--mask", action="store_true")
    ap.add_argument("--repair", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--delete-shells", action="store_true")
    ap.add_argument("--api", default="http://localhost:8000")
    ap.add_argument("--csv", default="")
    ap.add_argument("--embed-max-chars", type=int, default=6000)
    ap.add_argument("--timeout", type=float, default=900)
    args = ap.parse_args()

    root = to_local_path(args.root)
    with open(args.list_file, encoding="utf-8-sig") as f:
        paths = [to_local_path(l) for l in f if l.strip()]
    missing = [p for p in paths if not os.path.isfile(p)]
    if missing:
        print(f"!! {len(missing)} 個檔案不存在：", *missing[:10], sep="\n   ")

    client = httpx.Client(base_url=args.api, timeout=args.timeout)
    existing = fetch_existing(client, args.project_id)
    plan = plan_filenames(paths, root, existing)
    print(f"清單 {len(paths)} 檔；專案 {args.project_id} 既有 {len(existing)} 筆"
          f"（空殼 <{SHELL_MAX_CHARS} 字：{sum(1 for v in existing.values() if v < SHELL_MAX_CHARS)}）")

    rows = []
    t_all = time.perf_counter()
    for i, it in enumerate(plan, 1):
        p = it["path"]
        row = {k: it[k] for k in ("rel", "filename", "rename_reason", "overwrites_existing", "shell_basename")}
        ext = os.path.splitext(p)[1].lower().lstrip(".")
        row["ext"] = ext
        if p in missing:
            row.update(result="skipped", error_code="file_missing")
            rows.append(row)
            continue

        if args.dry_run:
            # 只在本機解析（mask=true、無 project_id → 不寫對照表；repair=false → 不 OCR）
            sc, body, ms = extract(client, p, mask=True, repair=False, project_id="")
            d = body.get("diagnostics") or {}
            if sc != 200:
                expect = f"error:{body.get('error_code')}"
            elif ext == "pdf" and (d.get("chars_per_page", 999) < 30 or
                                   d.get("nul_chars", 0) / max(d.get("nul_chars", 0) + d.get("text_chars", 0), 1) > 0.10):
                expect = "pdf_ocr"
            elif d.get("nul_chars") or d.get("radical_chars"):
                expect = "sanitize"
            elif not (body.get("text") or "").strip():
                expect = "empty"
            else:
                expect = "as_is"
            row.update(result="planned", expect=expect, status=sc, error_code=body.get("error_code", ""),
                       method=body.get("method", ""), suspected=d.get("suspected"),
                       nul_chars=d.get("nul_chars"), radical_chars=d.get("radical_chars"),
                       pages=d.get("pages"), chars_per_page=d.get("chars_per_page"),
                       text_chars=d.get("text_chars"), extract_ms=round(ms))
            print(f"[{i:>3}/{len(plan)}] {expect:<9} {it['filename']}"
                  + (f"  (←{it['rename_reason']}" + (f", 刪空殼 {it['shell_basename']}" if it["shell_basename"] else "") + ")"
                     if it["rename_reason"] else ("  (覆蓋既有)" if it["overwrites_existing"] else "")))
            rows.append(row)
            continue

        sc, body, ext_ms = extract(client, p, mask=args.mask, repair=args.repair, project_id=args.project_id)
        d = body.get("diagnostics") or {}
        row.update(status=sc, method=body.get("method", ""), repairs_applied="|".join(body.get("repairs_applied") or []),
                   suspected=d.get("suspected"), nul_chars=d.get("nul_chars"), radical_chars=d.get("radical_chars"),
                   pages=d.get("pages"), chars_per_page=d.get("chars_per_page"), text_chars=d.get("text_chars"),
                   text_chars_after=d.get("text_chars_after"), ocr_pages=d.get("ocr_pages"),
                   ocr_note=d.get("ocr_note", ""), mask_total=body.get("mask_total"), extract_ms=round(ext_ms))
        text = body.get("text") or ""
        if sc != 200:
            row.update(result="failed", stage="extract", error_code=body.get("error_code", f"http_{sc}"),
                       reason=body.get("reason", "")[:200])
        elif not text.strip():
            row.update(result="skipped", stage="extract", error_code="empty_text", reason="提取後無文字")
        else:
            row["text_len"] = len(text)
            t0 = time.perf_counter()
            r = client.post("/api/documents/index",
                            json={"project_id": args.project_id, "filename": it["filename"], "text": text})
            row["index_ms"] = round((time.perf_counter() - t0) * 1000)
            if r.status_code == 200:
                row["result"] = "success"
                row["embed_chars"] = min(len(text), args.embed_max_chars)
                if args.delete_shells and it["shell_basename"]:
                    try:
                        row["shell_deleted"] = delete_shell(args.project_id, it["shell_basename"])
                    except Exception as exc:  # noqa: BLE001
                        row["shell_deleted"] = f"error: {exc}"[:200]
            else:
                try:
                    eb = r.json()
                except ValueError:
                    eb = {"reason": r.text[:200]}
                row.update(result="failed", stage="index", status=r.status_code,
                           error_code=eb.get("error_code", f"http_{r.status_code}"), reason=str(eb.get("reason", ""))[:200])
        print(f"[{i:>3}/{len(plan)}] {row['result']:<7} {row.get('method',''):<18} "
              f"{row.get('text_chars_after') or 0:>6}字 遮罩{row.get('mask_total') or 0:>3} "
              f"{row.get('extract_ms',0)/1000:6.1f}s+{(row.get('index_ms') or 0)/1000:4.1f}s  {it['filename']}"
              + (f"  [{row.get('error_code')}]" if row["result"] != "success" else ""))
        rows.append(row)

    total_s = time.perf_counter() - t_all
    res = Counter(r["result"] for r in rows)
    print("\n== 統計 ==")
    print("結果：", dict(res), f"總耗時 {total_s:.1f}s")
    if args.dry_run:
        print("預計處理：", dict(Counter(r.get("expect") for r in rows)))
    else:
        fails = Counter(f"{r.get('stage')}:{r.get('error_code')}" for r in rows if r["result"] != "success")
        if fails:
            print("失敗 / 略過原因：", dict(fails))
        print("method：", dict(Counter(r.get("method") for r in rows if r["result"] == "success")))
        emb = sum(r.get("embed_chars") or 0 for r in rows)
        print(f"送 embedding 字數 {emb}（估 {emb * 0.79:.0f} tokens @0.79/字）")
        print("刪除空殼：", sum(r["shell_deleted"] for r in rows if isinstance(r.get("shell_deleted"), int)))

    if args.csv:
        cols: list[str] = []
        for r in rows:
            for k in r:
                if k not in cols:
                    cols.append(k)
        with open(args.csv, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.DictWriter(f, fieldnames=cols)
            w.writeheader()
            w.writerows(rows)
        print("CSV：", args.csv)
    return 0 if all(r["result"] in ("success", "planned") for r in rows) else 1


if __name__ == "__main__":
    sys.exit(main())
