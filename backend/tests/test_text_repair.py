"""
services/text_repair.py 與 services/doc_errors.py 單元測試（合成資料）。
容器內沒有 pytest 時可直接執行：python tests/test_text_repair.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import httpx  # noqa: E402

from services.doc_errors import (  # noqa: E402
    classify_db_error, classify_embedding_error, precheck_index_text,
)
from services.ollama_service import LLMProviderError  # noqa: E402
from services.text_repair import (  # noqa: E402
    count_text_chars, decode_text_bytes, diagnose, needs_pdf_ocr, sanitize, tidy_ocr_text,
)


# ── sanitize ───────────────────────────────────────────────────────────
def test_sanitize_strips_nul_and_controls_keeps_newline_tab():
    t, applied = sanitize("甲\x00乙\x01丙\t丁\n戊\x7f己​庚﻿")
    assert t == "甲乙丙\t丁\n戊己庚"
    assert applied == ["strip_nul", "strip_control"]


def test_sanitize_crlf_to_lf():
    t, applied = sanitize("a\r\nb\rc")
    assert t == "a\nb\nc" and "strip_control" in applied


def test_sanitize_nfkc_kangxi_radicals():
    t, applied = sanitize("⼿⼯⾃動化")  # U+2F3F U+2F2F U+2F83
    assert t == "手工自動化"
    assert applied == ["nfkc"]


def test_sanitize_nfkc_fullwidth():
    t, _ = sanitize("ＡＢＣ１２３")
    assert t == "ABC123"


def test_sanitize_noop():
    t, applied = sanitize("一般文字 ABC\n第二行")
    assert t == "一般文字 ABC\n第二行" and applied == []
    assert sanitize("") == ("", [])


def test_tidy_ocr_text():
    assert tidy_ocr_text("臺 灣 士 林 地 方 法 院 ABC def\n\n\n\n下 一 段") == "臺灣士林地方法院 ABC def\n\n下一段"


def test_count_text_chars():
    assert count_text_chars("a b\n\x00​中") == 3


# ── diagnose ───────────────────────────────────────────────────────────
def test_diagnose_normal_pdf():
    d = diagnose("正常的文字內容" * 20, pages=2)
    assert d["nul_chars"] == 0 and d["radical_chars"] == 0
    assert d["text_chars"] == 140 and d["pages"] == 2 and d["chars_per_page"] == 70.0
    assert d["suspected"] is None
    assert not needs_pdf_ocr(d)


def test_diagnose_scanned_pdf():
    d = diagnose("頁首\n\n", pages=5)
    assert d["suspected"] == "scanned_pdf" and d["chars_per_page"] == 0.4
    assert needs_pdf_ocr(d)


def test_diagnose_empty_pdf_zero_pages():
    d = diagnose("", pages=0)
    assert d["suspected"] == "scanned_pdf" and d["chars_per_page"] == 0.0


def test_diagnose_text_layer_broken_heavy_nul():
    text = ("\x00\x00\x00字" * 100)
    d = diagnose(text, pages=1)
    assert d["nul_chars"] == 300 and d["text_chars"] == 100
    assert d["suspected"] == "text_layer_broken"
    assert needs_pdf_ocr(d)          # 75% NUL > 10%


def test_diagnose_light_nul_no_ocr():
    text = "正常文字" * 100 + "\x00"
    d = diagnose(text, pages=2)
    assert d["suspected"] == "text_layer_broken"
    assert not needs_pdf_ocr(d)      # 只靠 sanitize 就能修


def test_diagnose_radicals():
    d = diagnose("⼿⼯⾃動化系統維護" * 10)
    assert d["radical_chars"] == 30 and d["suspected"] == "text_layer_broken"
    assert "pages" not in d and "chars_per_page" not in d


def test_diagnose_non_pdf_no_scanned():
    d = diagnose("短")
    assert d["suspected"] is None


# ── txt 編碼 ───────────────────────────────────────────────────────────
def test_decode_utf8_big5_utf16():
    s = "臺灣士林地方法院 111 年度"
    assert decode_text_bytes(s.encode("utf-8")) == (s, "utf-8")
    assert decode_text_bytes(s.encode("utf-8-sig"))[0] == s
    assert decode_text_bytes(s.encode("cp950")) == (s, "cp950")
    assert decode_text_bytes(s.encode("utf-16")) [0] == s                     # 有 BOM
    assert decode_text_bytes("hello world 123".encode("utf-16-le")) == ("hello world 123", "utf-16-le")
    assert decode_text_bytes("hello world 123".encode("utf-16-be")) == ("hello world 123", "utf-16-be")


# ── 錯誤分類 ───────────────────────────────────────────────────────────
def test_precheck():
    assert precheck_index_text("正常") is None
    e = precheck_index_text("   \n")
    assert e.status == 422 and e.error_code == "empty_text"
    e = precheck_index_text(None)
    assert e.error_code == "empty_text"
    e = precheck_index_text("a\x00b\x00")
    assert e.status == 422 and e.error_code == "nul_in_text" and "修復模式" in e.hint
    body = e.body()
    assert set(body) == {"error_code", "reason", "hint", "detail"}


def test_classify_embedding():
    e = classify_embedding_error(LLMProviderError("OpenAI-compatible API error: HTTP 429 x — quota", status_code=429))
    assert e.status == 502 and e.error_code == "embedding_failed" and "429" in e.reason and "額度" in e.hint
    e = classify_embedding_error(LLMProviderError("OpenAI-compatible API error: HTTP 401 x — no"))  # 從訊息解析
    assert "401" in e.reason and "金鑰" in e.hint
    e = classify_embedding_error(httpx.ConnectTimeout("timeout"))
    assert e.error_code == "embedding_failed" and "逾時" in e.hint


def test_classify_db():
    e = classify_db_error(Exception('invalid byte sequence for encoding "UTF8": 0x00'))
    assert e.status == 422 and e.error_code == "nul_in_text"
    e = classify_db_error(Exception("connection refused"))
    assert e.status == 500 and e.error_code == "db_error"


def test_structured_response():
    r = precheck_index_text("").response()
    assert r.status_code == 422
    assert json.loads(r.body)["error_code"] == "empty_text"


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
