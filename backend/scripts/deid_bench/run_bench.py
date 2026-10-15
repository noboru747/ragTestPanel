"""
脫敏方法基準測試：規則式 (masking.mask_text) vs Ollama vs ModaOne（OpenAI 相容）。

在後端容器內執行（可 import services.masking、可連 ollama:11434、環境變數已含 OPENAI_*）：
    docker exec -w /app/scripts/deid_bench rga_backend python run_bench.py --methods rule
    docker exec -w /app/scripts/deid_bench rga_backend python run_bench.py --methods ollama --docs 3
    docker exec -w /app/scripts/deid_bench rga_backend python run_bench.py --methods modaone \
        --modaone-models Llama-3.3-70B-Instruct,gpt-oss-120b
    docker exec -w /app/scripts/deid_bench rga_backend python run_bench.py --score-only

原始結果：<out>/raw_<method>__<model>.json；評分：<out>/scores_by_category.csv、per_doc.csv、summary.json、tables.md
ModaOne 使用規則：只打 /chat/completions，依序不併發；累計 tokens 超過 --budget 即停止。
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import time
from pathlib import Path

import httpx

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent.parent))  # /app → import services.masking

CATS = ["person", "national_id", "phone", "email", "address", "birth_date", "bank_account",
        "salary", "ip", "url_internal", "account", "credential"]

SYSTEM = ("你是資料脫敏（去識別化）偵測助手。你的工作是從使用者提供的文件中，找出所有個人資料與敏感資訊片段，"
          "並以 JSON 回傳。只回傳 JSON，不要任何說明文字。")

USER_TMPL = """請找出下列文件中所有需要遮蔽的敏感資料片段。

【類別定義】（category 只能使用以下英文代碼）
- person：自然人姓名（表格中的姓名、內文中提到的人名；不含職稱）
- national_id：身分證字號、居留證號、護照號碼
- phone：手機、市話、分機（個人或承辦人聯絡電話）
- email：電子郵件地址
- address：個人住址（戶籍、通訊、居住、隔離地址）
- birth_date：出生日期
- bank_account：銀行帳號
- salary：個人薪資、加班費、獎金、勞保/健保/勞退金額、期望薪資
- ip：IP 位址
- url_internal：內部網址（私有 IP 或內部網域的網址）
- account：系統帳號、使用者名稱、登入帳號
- credential：密碼、口令、金鑰

【不算敏感、不要列出】
公司/機關/法院名稱、公開辦公地址、公開網站、機關專線、契約編號、公文字號、契約總價與採購金額、
一般日期（出生日期除外）、版本號、法規條號、主機名稱。

【輸出規則】
1. text 必須是文件中逐字出現的原始字串，不可改寫、補字、翻譯或加註。
2. 只列值本身，不要包含欄位名稱（例如「姓名：王小明」只列「王小明」）。
3. 同一個值重複出現只需列一次。
4. 只輸出 JSON 物件：{{"items": [{{"text": "...", "category": "..."}}]}}；沒有就輸出 {{"items": []}}。

【文件】
<<<
{doc}
>>>"""

CAT_ALIASES = {
    "name": "person", "person_name": "person", "人名": "person", "姓名": "person",
    "id": "national_id", "id_number": "national_id", "passport": "national_id", "身分證": "national_id",
    "mobile": "phone", "telephone": "phone", "tel": "phone", "phone_number": "phone", "電話": "phone",
    "mail": "email", "e-mail": "email",
    "dob": "birth_date", "birthday": "birth_date", "birthdate": "birth_date",
    "bank": "bank_account", "account_number": "bank_account",
    "amount": "salary", "wage": "salary", "money": "salary",
    "ip_address": "ip", "ipv4": "ip", "mac": "ip",
    "url": "url_internal", "internal_url": "url_internal",
    "username": "account", "user": "account", "user_account": "account",
    "password": "credential", "api_key": "credential", "secret": "credential", "token": "credential",
}


def norm_cat(c) -> str:
    c = str(c or "").strip().lower()
    if c in CATS:
        return c
    return CAT_ALIASES.get(c, "other")


def norm_text(s: str) -> str:
    return re.sub(r"\s+", " ", str(s)).strip().strip("「」\"'`")


# ── 資料 ──────────────────────────────────────────────────────────────
def load_data(data_dir: Path, n: int | None):
    gt = json.loads((data_dir / "ground_truth.json").read_text(encoding="utf-8"))
    if n:
        gt = gt[:n]
    for g in gt:
        g["text"] = (data_dir / "docs" / f"{g['doc_id']}.txt").read_text(encoding="utf-8")
    return gt


def chunk_text(text: str, max_chars: int) -> list[str]:
    if len(text) <= max_chars:
        return [text]
    chunks, cur = [], ""
    for line in text.split("\n"):
        if cur and len(cur) + len(line) + 1 > max_chars:
            chunks.append(cur)
            cur = ""
        cur += line + "\n"
    if cur.strip():
        chunks.append(cur)
    return chunks


def parse_items(content: str):
    """回傳 list[{text,category}] 或 None（解析失敗）"""
    if content is None:
        return None
    s = content.strip()
    s = re.sub(r"^```(?:json)?\s*|\s*```$", "", s)
    obj = None
    try:
        obj = json.loads(s)
    except Exception:
        m = re.search(r"(\{.*\}|\[.*\])", s, re.S)
        if m:
            try:
                obj = json.loads(m.group(1))
            except Exception:
                return None
    if obj is None:
        return None
    if isinstance(obj, dict):
        lst = obj.get("items")
        if lst is None:
            lst = next((v for v in obj.values() if isinstance(v, list)), None)
        obj = lst
    if not isinstance(obj, list):
        return None
    out = []
    for it in obj:
        if isinstance(it, dict) and isinstance(it.get("text"), (str, int, float)) and str(it["text"]).strip():
            out.append({"text": str(it["text"]), "category": norm_cat(it.get("category"))})
    return out


# ── (A) 規則式 ───────────────────────────────────────────────────────
RULE_CAT = {"mac": "ip", "api_key": "credential"}


def run_rule(docs, repeat: int = 20):
    from services.masking import mask_text
    results = []
    for d in docs:
        t0 = time.perf_counter()
        for _ in range(repeat):
            _, _, mappings = mask_text(d["text"], with_mappings=True)
        sec = (time.perf_counter() - t0) / repeat
        items = [{"text": m["original"], "category": RULE_CAT.get(m["category"], m["category"])} for m in mappings]
        results.append({"doc_id": d["doc_id"], "chars": len(d["text"]), "seconds": sec, "chunks": 1,
                        "requests": 1, "parse_ok": True, "retries": 0, "items": items})
        print(f"  rule {d['doc_id']}: {len(items)} items {sec*1000:.2f} ms")
    return results


# ── (B) Ollama ───────────────────────────────────────────────────────
def run_ollama(docs, model: str, chunk_chars: int, num_ctx: int, num_predict: int):
    base = os.environ.get("OLLAMA_BASE_URL", "http://ollama:11434").rstrip("/")
    client = httpx.Client(timeout=1800)
    t0 = time.perf_counter()
    w = client.post(f"{base}/api/chat", json={"model": model, "stream": False, "keep_alive": "30m",
                                              "messages": [{"role": "user", "content": "hi"}],
                                              "options": {"num_ctx": num_ctx, "num_predict": 1}}).json()
    warm = {"wall_s": time.perf_counter() - t0, "load_s": w.get("load_duration", 0) / 1e9}
    print(f"  ollama warmup {warm}")
    results = []
    for d in docs:
        chunks = chunk_text(d["text"], chunk_chars)
        rec = {"doc_id": d["doc_id"], "chars": len(d["text"]), "seconds": 0.0, "chunks": len(chunks), "requests": 0,
               "prompt_tokens": 0, "completion_tokens": 0, "prompt_eval_s": 0.0, "eval_s": 0.0,
               "parse_ok": True, "retries": 0, "parse_failures": 0, "items": [], "errors": []}
        for ch in chunks:
            for attempt in range(2):
                payload = {"model": model, "stream": False, "format": "json", "keep_alive": "30m",
                           "messages": [{"role": "system", "content": SYSTEM},
                                        {"role": "user", "content": USER_TMPL.format(doc=ch)}],
                           "options": {"temperature": 0, "num_ctx": num_ctx, "num_predict": num_predict}}
                t1 = time.perf_counter()
                try:
                    r = client.post(f"{base}/api/chat", json=payload).json()
                except Exception as e:  # noqa: BLE001
                    r = {"error": repr(e)}
                rec["seconds"] += time.perf_counter() - t1
                rec["requests"] += 1
                rec["prompt_tokens"] += r.get("prompt_eval_count", 0)
                rec["completion_tokens"] += r.get("eval_count", 0)
                rec["prompt_eval_s"] += r.get("prompt_eval_duration", 0) / 1e9
                rec["eval_s"] += r.get("eval_duration", 0) / 1e9
                items = parse_items((r.get("message") or {}).get("content")) if "error" not in r else None
                if items is not None:
                    rec["items"] += items
                    break
                rec["parse_failures"] += 1
                rec["errors"].append(str(r.get("error") or (r.get("message") or {}).get("content", ""))[:300])
                if attempt == 0:
                    rec["retries"] += 1
                else:
                    rec["parse_ok"] = False
        print(f"  ollama {d['doc_id']}: {len(rec['items'])} items {rec['seconds']:.1f}s chunks={len(chunks)} "
              f"in={rec['prompt_tokens']} out={rec['completion_tokens']} ok={rec['parse_ok']} retries={rec['retries']}")
        results.append(rec)
    return results, {"warmup": warm, "chunk_chars": chunk_chars, "num_ctx": num_ctx}


# ── (C) ModaOne（OpenAI 相容）──────────────────────────────────────────
class Budget:
    def __init__(self, limit: int, path: Path):
        self.limit, self.path = limit, path
        self.used = json.loads(path.read_text())["used"] if path.exists() else 0

    def add(self, n: int):
        self.used += n
        self.path.write_text(json.dumps({"used": self.used}))

    def check(self, est: int) -> bool:
        return self.used + est <= self.limit


def _env_key() -> tuple[str, str]:
    base = os.environ.get("OPENAI_BASE_URL", "https://modaone-llm-api.dginfra.gov.tw/api/v1").rstrip("/")
    key = os.environ.get("OPENAI_API_KEY", "")
    if not key:
        envf = Path(os.environ.get("MODAONE_ENV_FILE", "/nonexistent"))
        if envf.exists():
            for line in envf.read_text().splitlines():
                if line.startswith("OPENAI_API_KEY="):
                    key = line.split("=", 1)[1].strip()
    if not key:
        raise SystemExit("OPENAI_API_KEY 未設定")
    return base, key


def _chat(client, base, key, payload):
    t0 = time.perf_counter()
    r = client.post(f"{base}/chat/completions", json=payload, headers={"Authorization": f"Bearer {key}"})
    return r, time.perf_counter() - t0


def run_modaone(docs, model: str, budget: Budget, max_tokens: int, pings: int = 3):
    base, key = _env_key()
    client = httpx.Client(timeout=600)
    meta = {"ping_s": [], "response_format": True}
    # 網路 + 排隊基線延遲：極小請求
    for _ in range(pings):
        r, sec = _chat(client, base, key, {"model": model, "temperature": 0, "max_tokens": 1,
                                           "messages": [{"role": "user", "content": "OK"}]})
        if r.status_code == 200:
            u = r.json().get("usage") or {}
            budget.add(u.get("total_tokens", 0) or 10)
            meta["ping_s"].append(sec)
        else:
            print(f"  ping HTTP {r.status_code}: {r.text[:200]}")
    print(f"  ping {model}: {[round(x, 2) for x in meta['ping_s']]}")
    results = []
    for d in docs:
        rec = {"doc_id": d["doc_id"], "chars": len(d["text"]), "seconds": 0.0, "chunks": 1, "requests": 0,
               "prompt_tokens": 0, "completion_tokens": 0, "parse_ok": True, "retries": 0, "parse_failures": 0,
               "items": [], "errors": []}
        est = int(len(d["text"]) * 1.6) + 1200 + max_tokens
        if not budget.check(est):
            print(f"  !! 預算不足（已用 {budget.used}，預估 {est}），停止")
            rec.update(parse_ok=False, skipped=True)
            results.append(rec)
            break
        for attempt in range(2):
            payload = {"model": model, "temperature": 0, "max_tokens": max_tokens,
                       "messages": [{"role": "system", "content": SYSTEM},
                                    {"role": "user", "content": USER_TMPL.format(doc=d["text"])}]}
            if meta["response_format"]:
                payload["response_format"] = {"type": "json_object"}
            r, sec = _chat(client, base, key, payload)
            if r.status_code == 400 and meta["response_format"] and "response_format" in r.text:
                meta["response_format"] = False
                payload.pop("response_format")
                r, sec2 = _chat(client, base, key, payload)
                sec += sec2
            rec["seconds"] += sec
            rec["requests"] += 1
            content = None
            if r.status_code == 200:
                j = r.json()
                u = j.get("usage") or {}
                rec["prompt_tokens"] += u.get("prompt_tokens", 0)
                rec["completion_tokens"] += u.get("completion_tokens", 0)
                budget.add(u.get("total_tokens", 0) or (u.get("prompt_tokens", 0) + u.get("completion_tokens", 0)))
                msg = (j.get("choices") or [{}])[0].get("message") or {}
                content = msg.get("content")
                rec["finish_reason"] = (j.get("choices") or [{}])[0].get("finish_reason")
            else:
                rec["errors"].append(f"HTTP {r.status_code}: {r.text[:300]}")
            items = parse_items(content)
            if items is not None:
                rec["items"] = items
                break
            rec["parse_failures"] += 1
            if content is not None:
                rec["errors"].append(str(content)[:300])
            if attempt == 0:
                rec["retries"] += 1
            else:
                rec["parse_ok"] = False
        print(f"  {model} {d['doc_id']}: {len(rec['items'])} items {rec['seconds']:.1f}s "
              f"in={rec['prompt_tokens']} out={rec['completion_tokens']} ok={rec['parse_ok']} 累計={budget.used}")
        results.append(rec)
    return results, meta


# ── 評分 ─────────────────────────────────────────────────────────────
def lenient_eq(a: str, b: str, url: bool) -> bool:
    if a == b:
        return True
    short, long_ = sorted((a, b), key=len)
    if len(short) < 2 or short not in long_:
        return False
    return url and len(short) >= 4 or len(short) / len(long_) >= 0.3


def score_run(docs, results):
    by_doc = {r["doc_id"]: r for r in results}
    cat_stats = {m: {c: {"gold": 0, "tp": 0, "fn": 0, "fp": 0} for c in CATS + ["other"]} for m in ("strict", "lenient")}
    tot = {m: {"gold": 0, "matched": 0, "pred": 0, "pred_tp": 0} for m in ("strict", "lenient")}
    halluc = distractor_fp = cat_agree = cat_agree_n = 0
    per_doc = []
    for d in docs:
        r = by_doc.get(d["doc_id"])
        if r is None:
            continue
        gold = [(norm_text(g["text"]), g["category"]) for g in d["sensitive"]]
        ns = [norm_text(x["text"]) for x in d["non_sensitive"]]
        doc_norm = norm_text(d["text"])
        preds, seen = [], set()
        for it in r["items"]:
            t = norm_text(it["text"])
            if t and t not in seen:
                seen.add(t)
                preds.append((t, it["category"]))
        h = sum(1 for t, _ in preds if t not in doc_norm)
        halluc += h
        row = {"doc_id": d["doc_id"], "gold": len(gold), "pred": len(preds), "hallucinated": h}
        for mode in ("strict", "lenient"):
            def eq(p, g):
                return p == g[0] if mode == "strict" else lenient_eq(p, g[0], g[1] == "url_internal")
            matched_gold = [any(eq(p, g) for p, _ in preds) for g in gold]
            pred_tp = [any(eq(p, g) for g in gold) for p, _ in preds]
            for g, m in zip(gold, matched_gold):
                st = cat_stats[mode][g[1]]
                st["gold"] += 1
                st["tp" if m else "fn"] += 1
            for (p, c), ok in zip(preds, pred_tp):
                if not ok:
                    cat_stats[mode][c if c in CATS else "other"]["fp"] += 1
                    if mode == "lenient" and any(lenient_eq(p, x, False) for x in ns):
                        distractor_fp += 1
                if mode == "strict" and ok:
                    gc = next(g[1] for g in gold if p == g[0])
                    cat_agree_n += 1
                    cat_agree += gc == c
            tot[mode]["gold"] += len(gold)
            tot[mode]["matched"] += sum(matched_gold)
            tot[mode]["pred"] += len(preds)
            tot[mode]["pred_tp"] += sum(pred_tp)
            row[f"{mode}_recall"] = round(sum(matched_gold) / len(gold), 3) if gold else None
            row[f"{mode}_precision"] = round(sum(pred_tp) / len(preds), 3) if preds else None
        per_doc.append(row)

    def prf(tp_r, gold, tp_p, pred):
        R = tp_r / gold if gold else 0.0
        P = tp_p / pred if pred else 0.0
        F = 2 * P * R / (P + R) if P + R else 0.0
        return round(P, 3), round(R, 3), round(F, 3)

    summary = {}
    for mode in ("strict", "lenient"):
        t = tot[mode]
        P, R, F = prf(t["matched"], t["gold"], t["pred_tp"], t["pred"])
        cats = {}
        for c, st in cat_stats[mode].items():
            if not st["gold"] and not st["fp"]:
                continue
            # 類別 precision：TP 以 gold 類別計（片段比對不看類別），FP 以模型標的類別計
            cP, cR, cF = prf(st["tp"], st["gold"], st["tp"], st["tp"] + st["fp"])
            cats[c] = {**st, "precision": cP, "recall": cR, "f1": cF}
        summary[mode] = {"precision": P, "recall": R, "f1": F, **t, "by_category": cats}
    summary["hallucinated"] = halluc
    summary["distractor_fp"] = distractor_fp
    summary["category_agreement"] = round(cat_agree / cat_agree_n, 3) if cat_agree_n else None
    return summary, per_doc


def speed_summary(results, meta=None):
    ok = [r for r in results if not r.get("skipped")]
    chars = sum(r["chars"] for r in ok)
    sec = sum(r["seconds"] for r in ok)
    s = {"docs": len(ok), "chars": chars, "seconds": round(sec, 3), "requests": sum(r.get("requests", 1) for r in ok),
         "chars_per_s": round(chars / sec, 2) if sec else None,
         "parse_fail_docs": sum(1 for r in ok if not r["parse_ok"]),
         "parse_failures": sum(r.get("parse_failures", 0) for r in ok),
         "retries": sum(r.get("retries", 0) for r in ok),
         "chunks": sum(r.get("chunks", 1) for r in ok)}
    pt = sum(r.get("prompt_tokens", 0) for r in ok)
    ct = sum(r.get("completion_tokens", 0) for r in ok)
    if pt or ct:
        s.update(prompt_tokens=pt, completion_tokens=ct, tokens_per_char_in=round(pt / chars, 3),
                 out_tokens_per_char=round(ct / chars, 4), total_tok_per_s=round((pt + ct) / sec, 1),
                 out_tok_per_s_wall=round(ct / sec, 1))
    pe = sum(r.get("prompt_eval_s", 0) for r in ok)
    ev = sum(r.get("eval_s", 0) for r in ok)
    if pe and ev:
        s.update(prefill_tok_per_s=round(pt / pe, 1), decode_tok_per_s=round(ct / ev, 1),
                 prefill_s=round(pe, 1), decode_s=round(ev, 1))
    if meta and meta.get("ping_s"):
        ping = sum(meta["ping_s"]) / len(meta["ping_s"])
        net = max(sec - ping * s["requests"], 1e-6)
        s.update(avg_ping_s=round(ping, 3), seconds_ex_latency=round(net, 2), chars_per_s_ex_latency=round(chars / net, 2))
    if s["chars_per_s"]:
        s["hours_for_1_5M_chars"] = round(1_500_000 / s["chars_per_s"] / 3600, 3)
    if s.get("chars_per_s_ex_latency"):
        s["hours_for_1_5M_chars_ex_latency"] = round(1_500_000 / s["chars_per_s_ex_latency"] / 3600, 3)
    return s


def score_all(docs, out: Path):
    summary, cat_rows, doc_rows = {}, [], []
    for f in sorted(out.glob("raw_*.json")):
        raw = json.loads(f.read_text(encoding="utf-8"))
        tag = raw["tag"]
        q, per_doc = score_run(docs, raw["results"])
        sp = speed_summary(raw["results"], raw.get("meta"))
        summary[tag] = {"speed": sp, "quality": q, "meta": raw.get("meta")}
        for mode in ("strict", "lenient"):
            for c, st in q[mode]["by_category"].items():
                cat_rows.append({"method": tag, "mode": mode, "category": c, **st})
        for row in per_doc:
            doc_rows.append({"method": tag, **row})
    (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    for name, rows in (("scores_by_category.csv", cat_rows), ("per_doc.csv", doc_rows)):
        if rows:
            keys = list(dict.fromkeys(k for r in rows for k in r))
            with open(out / name, "w", newline="", encoding="utf-8-sig") as fh:
                w = csv.DictWriter(fh, fieldnames=keys)
                w.writeheader()
                w.writerows(rows)
    write_tables(summary, out / "tables.md")
    return summary


def write_tables(summary, path: Path):
    L = ["## 速度", "", "| 方法 | 份數 | 字數 | 請求數 | 秒 | 字/秒 | in tok | out tok | 讀取 tok/s | 生成 tok/s | 150萬字(小時) |",
         "|---|---|---|---|---|---|---|---|---|---|---|"]
    for tag, s in summary.items():
        sp = s["speed"]
        L.append(f"| {tag} | {sp['docs']} | {sp['chars']} | {sp['requests']} | {sp['seconds']} | {sp['chars_per_s']} | "
                 f"{sp.get('prompt_tokens', '-')} | {sp.get('completion_tokens', '-')} | {sp.get('prefill_tok_per_s', '-')} | "
                 f"{sp.get('decode_tok_per_s', sp.get('out_tok_per_s_wall', '-'))} | {sp.get('hours_for_1_5M_chars')} |")
    L += ["", "## 整體品質", "", "| 方法 | 嚴格 P | 嚴格 R | 嚴格 F1 | 寬鬆 P | 寬鬆 R | 寬鬆 F1 | 預測數 | 幻覺 | 誤遮干擾項 | 類別一致率 | 解析失敗(文件/次) | 重試 |",
          "|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for tag, s in summary.items():
        q, sp = s["quality"], s["speed"]
        L.append(f"| {tag} | {q['strict']['precision']} | {q['strict']['recall']} | {q['strict']['f1']} | "
                 f"{q['lenient']['precision']} | {q['lenient']['recall']} | {q['lenient']['f1']} | {q['lenient']['pred']} | "
                 f"{q['hallucinated']} | {q['distractor_fp']} | {q['category_agreement']} | {sp['parse_fail_docs']}/{sp['parse_failures']} | {sp['retries']} |")
    tags = list(summary)
    L += ["", "## 各類別 Recall（寬鬆 / 嚴格）", "", "| 類別 | gold | " + " | ".join(tags) + " |",
          "|---|---|" + "---|" * len(tags)]
    for c in CATS:
        g = max((s["quality"]["lenient"]["by_category"].get(c, {}).get("gold", 0) for s in summary.values()), default=0)
        cells = []
        for t in tags:
            le = summary[t]["quality"]["lenient"]["by_category"].get(c)
            st = summary[t]["quality"]["strict"]["by_category"].get(c)
            cells.append(f"{le['recall'] if le else 0} / {st['recall'] if st else 0}")
        L.append(f"| {c} | {g} | " + " | ".join(cells) + " |")
    L += ["", "## 各類別 F1（寬鬆）與 FP 數", "", "| 類別 | " + " | ".join(tags) + " |", "|---|" + "---|" * len(tags)]
    for c in CATS + ["other"]:
        cells = []
        for t in tags:
            le = summary[t]["quality"]["lenient"]["by_category"].get(c)
            cells.append(f"{le['f1']} (FP {le['fp']})" if le else "-")
        L.append(f"| {c} | " + " | ".join(cells) + " |")
    path.write_text("\n".join(L) + "\n", encoding="utf-8")


def save_raw(out: Path, method: str, model: str, results, meta=None):
    tag = f"{method}__{model}".replace("/", "_").replace(":", "_")
    (out / f"raw_{tag}.json").write_text(json.dumps({"tag": tag, "method": method, "model": model, "meta": meta,
                                                     "results": results}, ensure_ascii=False, indent=1), encoding="utf-8")


def make_combo(out: Path, tags: list[str]):
    """聯集多個方法的輸出（模擬「規則 + LLM」混合）：items 合併、耗時相加"""
    raws = [json.loads((out / f"raw_{t}.json").read_text(encoding="utf-8")) for t in tags]
    merged = []
    for recs in zip(*(r["results"] for r in raws)):
        assert len({x["doc_id"] for x in recs}) == 1
        m = {"doc_id": recs[0]["doc_id"], "chars": recs[0]["chars"], "chunks": max(x.get("chunks", 1) for x in recs),
             "seconds": sum(x["seconds"] for x in recs), "requests": sum(x.get("requests", 1) for x in recs),
             "parse_ok": all(x["parse_ok"] for x in recs), "retries": sum(x.get("retries", 0) for x in recs),
             "parse_failures": sum(x.get("parse_failures", 0) for x in recs),
             "prompt_tokens": sum(x.get("prompt_tokens", 0) for x in recs),
             "completion_tokens": sum(x.get("completion_tokens", 0) for x in recs),
             "items": [it for x in recs for it in x["items"]]}
        merged.append(m)
    tag = "combo__" + "+".join(t.split("__", 1)[1] for t in tags)
    (out / f"raw_{tag}.json").write_text(json.dumps({"tag": tag, "method": "combo", "model": "+".join(tags),
                                                     "meta": None, "results": merged}, ensure_ascii=False, indent=1),
                                         encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--methods", default="rule", help="rule,ollama,modaone")
    ap.add_argument("--docs", type=int, default=None, help="只跑前 N 份")
    ap.add_argument("--data", default=str(HERE / "data"))
    ap.add_argument("--out", default=str(HERE / "results"))
    ap.add_argument("--ollama-model", default="llama3.2:3b")
    ap.add_argument("--chunk-chars", type=int, default=2000)
    ap.add_argument("--num-ctx", type=int, default=8192)
    ap.add_argument("--num-predict", type=int, default=2048)
    ap.add_argument("--modaone-models", default="Llama-3.3-70B-Instruct")
    ap.add_argument("--max-tokens", type=int, default=4096)
    ap.add_argument("--budget", type=int, default=450_000, help="ModaOne 累計 tokens 上限（跨次執行累計）")
    ap.add_argument("--score-only", action="store_true")
    ap.add_argument("--combos", default="", help="以 ; 分隔，每組以 + 連接 raw tag，例如 rule__masking+ollama__llama3.2_3b")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    docs = load_data(Path(args.data), args.docs)
    if not args.score_only:
        for m in args.methods.split(","):
            m = m.strip()
            print(f"== {m}")
            if m == "rule":
                save_raw(out, "rule", "masking", run_rule(docs))
            elif m == "ollama":
                res, meta = run_ollama(docs, args.ollama_model, args.chunk_chars, args.num_ctx, args.num_predict)
                save_raw(out, "ollama", args.ollama_model, res, meta)
            elif m == "modaone":
                budget = Budget(args.budget, out / "modaone_budget.json")
                for model in args.modaone_models.split(","):
                    mt = max(args.max_tokens, 8192) if "gpt-oss" in model else args.max_tokens
                    res, meta = run_modaone(docs, model.strip(), budget, mt)
                    meta["budget_used_total"] = budget.used
                    save_raw(out, "modaone", model.strip(), res, meta)
                    print(f"  ModaOne 累計 tokens：{budget.used}")
    for c in filter(None, args.combos.split(";")):
        make_combo(out, c.split("+"))
    s = score_all(load_data(Path(args.data), None), out)
    print((out / "tables.md").read_text(encoding="utf-8"))


if __name__ == "__main__":
    main()
