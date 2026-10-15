"""
切段 / 中文二元組關鍵字 / 用量估算 / 上下文組裝 單元測試（合成資料，不連 DB、不呼叫平台）。
容器內執行：python tests/test_chunking.py（也相容 pytest）
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from services.chunker import chunk_text, compress_text, limit_text  # noqa: E402
from services.keywords import build_tsquery, document_terms, query_groups  # noqa: E402
from services.retrieval import Hit, build_context, merge_adjacent  # noqa: E402
from services.usage import build_record, estimate_tokens, usage_from_ollama, usage_from_openai  # noqa: E402


def _check_cover(text, chunks):
    """每段 = text[start:end]；段落依序、相鄰段之間沒有遺漏非空白內容。"""
    prev_end = 0
    for i, c in enumerate(chunks):
        assert c.index == i
        assert text[c.start:c.end] == c.content
        assert c.start < c.end
        assert not text[prev_end:c.start].strip() or c.start < prev_end, f"gap before chunk {i}"
        prev_end = max(prev_end, c.end)
    assert not text[prev_end:].strip()


# ── chunker ────────────────────────────────────────────────────────────
def test_short_text_single_chunk():
    cs = chunk_text("短文字。", size=600, overlap=100)
    assert len(cs) == 1 and cs[0].content == "短文字。" and cs[0].start == 0
    assert chunk_text("") == [] and chunk_text("  \n ") == []


def test_sentence_boundaries_and_overlap():
    sent = "本案駐點人員應遵守保密規定並配合機關作業。"   # 21 字
    text = sent * 80                                       # 1680 字，無換行
    cs = chunk_text(text, size=600, overlap=100)
    assert len(cs) >= 3
    _check_cover(text, cs)
    for c in cs:
        assert len(c.content) <= 600
        assert c.content.endswith("。")                    # 都在句號斷開
    for a, b in zip(cs, cs[1:]):
        assert b.start < a.end                              # 有重疊
        assert a.end - b.start <= 100


def test_paragraph_preferred():
    p1 = "第一段" + "甲" * 380 + "。"
    p2 = "第二段" + "乙" * 380 + "。"
    text = p1 + "\n\n" + p2
    cs = chunk_text(text, size=600, overlap=0)
    assert cs[0].content == p1 and cs[1].content == p2


def test_table_rows_not_split():
    rows = [f"|{i}|設備名稱{i}|規格說明，含逗號；分號。句號|數量{i}|" for i in range(60)]
    text = "\n".join(rows)
    cs = chunk_text(text, size=300, overlap=60)
    _check_cover(text, cs)
    for c in cs:
        for line in c.content.split("\n"):
            assert line.startswith("|") and line.endswith("|"), line   # 每行都是完整表格列


def test_long_single_row_extends_or_hard_cuts():
    row = "|" + "很長的儲存格內容" * 60 + "|"      # 482 字的一列
    cs = chunk_text("前言。\n" + row + "\n結尾。", size=200, overlap=0)
    assert any(c.content.endswith("|") for c in cs)
    huge = "字" * 5000                            # 沒有任何斷點 → 硬切
    cs = chunk_text(huge, size=600, overlap=100)
    assert all(len(c.content) <= 600 for c in cs) and "".join(c.content for c in cs if c.index == 0)
    _check_cover(huge, cs)


def test_marker_boundary():
    text = "說明文字。" * 70 + "\n=== 工作表2 ===\n" + "第二張表內容。" * 50
    cs = chunk_text(text, size=600, overlap=0)
    assert any(c.content.startswith("=== 工作表2 ===") for c in cs)


def test_compress_text():
    raw = "標題   \n\n\n\n\n|a| | | | |b|\n|---|---|\n1\t\t\t\t2\t\t\t\n\t\t\t\n   多    空白　　　x"
    out = compress_text(raw)
    assert "|a||b|" in out
    assert "---" not in out
    assert "1\t2" in out and "\t\t" not in out
    assert "\n\n\n" not in out
    assert "多  空白  x" in out
    big = ("內容\t" + "\t" * 5000 + "\n") * 100     # xlsx 膨脹
    assert len(compress_text(big)) < 400
    assert compress_text("") == ""


def test_limit_text():
    t = "一行文字\n" * 100
    s, cut = limit_text(t, 120)
    assert cut and len(s) <= 120 and s.endswith("文字")
    assert limit_text("abc", 10) == ("abc", False)


# ── keywords ───────────────────────────────────────────────────────────
def test_document_terms():
    assert document_terms("駐點人員 CW11105 罰則") == ["駐點", "點人", "人員", "cw11105", "罰則"]
    assert document_terms("【IP_1】主機") == ["主機"]       # 遮罩代號不當關鍵字
    assert document_terms("ＣＷ１１１０５") == ["cw11105"]   # NFKC + 小寫


def test_query_groups_stopwords():
    assert query_groups("駐點人員的資格條件是什麼") == [["駐點", "點人", "人員"], ["資格", "格條", "條件"]]
    assert query_groups("契約金額是多少") == [["契約", "約金", "金額"]]
    assert query_groups("罰則") == [["罰則"]]
    assert query_groups("履約保證金") == [["履約", "約保", "保證", "證金"]]          # 5 字仍是一個片語
    long_groups = query_groups("資訊軟硬體駐點人員勞務採購案")                    # 13 字 → 重疊視窗
    assert all(len(g) <= 6 for g in long_groups) and len(long_groups) == 3
    assert long_groups[0][-1] == long_groups[1][0]
    assert query_groups("CW11105 的保密") == [["cw11105"], ["保密"]]


def test_build_tsquery():
    assert build_tsquery("駐點人員 罰則") == "('駐點' <-> '點人' <-> '人員') | '罰則'"
    assert build_tsquery("是什麼") == ""
    assert build_tsquery("it's") == "'it'" or "''" not in build_tsquery("it's")


# ── usage ──────────────────────────────────────────────────────────────
def test_estimate_tokens():
    assert estimate_tokens("") == 0
    assert estimate_tokens("中" * 100) == 80          # 79 + 1
    assert estimate_tokens("abcd" * 10) == 11         # 40/4 + 1


def test_usage_parsers_and_record():
    assert usage_from_openai({"usage": {"prompt_tokens": 18, "total_tokens": 18}}) == (18, 0, 18)
    assert usage_from_openai({"usage": {"prompt_tokens": 0, "total_tokens": 0}}) is None
    assert usage_from_openai({}) is None
    assert usage_from_ollama({"prompt_eval_count": 10, "eval_count": 5}) == (10, 5, 15)
    assert usage_from_ollama({"embeddings": []}) is None
    r = build_record(provider="openai", model="m", operation="embed", endpoint="embeddings",
                     usage=None, prompt_text="中" * 100, project_id="p1")
    assert r["estimated"] and r["total_tokens"] == 80 and r["project_id"] == "p1"
    r = build_record(provider="openai", model="m", operation="chat", endpoint="x", usage=(5, 7, 12))
    assert not r["estimated"] and r["completion_tokens"] == 7


# ── 上下文組裝 ─────────────────────────────────────────────────────────
def _hit(doc, idx, start, end, content, rel, fn=None):
    return Hit(doc, fn or f"f{doc}.pdf", idx, 10, start, end, content, rel, 0.0, rel)


def test_merge_adjacent_and_context():
    hits = [
        _hit(1, 3, 1000, 1600, "A" * 500 + "重疊尾巴", 0.9),
        _hit(2, 0, 0, 600, "B" * 600, 0.8),
        _hit(1, 4, 1500, 2100, "重疊尾巴" + "C" * 96, 0.7),   # 與上一段重疊 100 字
        _hit(1, 7, 3000, 3600, "D" * 600, 0.6),
    ]
    blocks = merge_adjacent(hits)
    assert [b.label for b in blocks] == ["【文件：f1.pdf｜第 4-5 段】", "【文件：f1.pdf｜第 8 段】", "【文件：f2.pdf｜第 1 段】"]
    assert blocks[0].content.count("重疊尾巴") == 1
    ctx, used = build_context(blocks, max_chars=10000)
    assert ctx.index("f1.pdf｜第 4-5 段") < ctx.index("f1.pdf｜第 8 段") < ctx.index("f2.pdf")
    ctx, used = build_context(blocks, max_chars=900)
    assert len(ctx) <= 900 and len(used) == 2 and ctx.endswith("…")


if __name__ == "__main__":
    failed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"PASS {name}")
            except Exception as exc:  # noqa: BLE001
                failed += 1
                print(f"FAIL {name}: {exc!r}")
    print("ALL PASSED" if not failed else f"{failed} FAILED")
    sys.exit(1 if failed else 0)
