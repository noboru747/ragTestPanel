"""
文件切段（純函式，無 I/O）。

compress_text()：入庫前的空白壓縮（xlsx 尾端空儲存格、連續空白欄 | | |、大量空白列…）
chunk_text()   ：依目標長度切段，回傳 Chunk(index, content, start, end)，start/end 為在輸入文字中的位置 [start, end)

斷點優先序（在視窗後半段內挑最高優先、同優先取最後一個）：
  4 頁碼 / 工作表 / 投影片標記行之前（=== xxx ===、第 N 頁、- N -、Page N）
  3 段落（空行）
  2 換行（表格列 = 一行，因此表格只會在列與列之間斷開）
  1 句末標點（。！？；!?;）— 只在非表格行內
表格列（| 開頭或含 2 個以上 tab 的行）不會在列中間切斷；單列超過上限時延伸到列尾（最多 3 倍上限），
再不行才硬切。重疊：下一段從「上一段結尾往前 overlap 字內的第一個斷點」開始。
"""
from __future__ import annotations

import bisect
import os
import re
from dataclasses import dataclass

CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "600"))
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "100"))
MAX_DOC_CHARS = int(os.getenv("MAX_DOC_CHARS", "300000"))

_MARKER_RE = re.compile(
    r"^\s*(?:={2,}.*={2,}|第\s*\d+\s*頁.*|[-—–]\s*\d+\s*[-—–]|page\s+\d+(?:\s*(?:/|of)\s*\d+)?|\f.*)\s*$",
    re.IGNORECASE,
)
_SENT_END = set("。！？；!?;")


@dataclass
class Chunk:
    index: int
    content: str
    start: int
    end: int


# ── 壓縮 ────────────────────────────────────────────────────────────────
_EMPTY_CELLS_RE = re.compile(r"\|(?:[ \t　]*\|){2,}")       # | | | |（連續空欄）→ ||
_TABS_RE = re.compile(r"\t{2,}")                                # 連續 tab（xlsx 空儲存格）→ 單一 tab
_SPACES_RE = re.compile(r"[ 　 ]{3,}")                 # 3 個以上空白 → 2 個（保留些許版面）
_SEP_ONLY_RE = re.compile(r"^[\s|\-_=+:.·,，]*$")                # 只有分隔符號的列
_BLANK_LINES_RE = re.compile(r"\n{3,}")


def compress_text(text: str) -> str:
    """空白 / 空儲存格壓縮。不改變任何非空白文字內容。"""
    if not text:
        return ""
    out: list[str] = []
    for line in text.split("\n"):
        line = line.rstrip()
        if not line:
            out.append("")
            continue
        if "|" in line:
            line = _EMPTY_CELLS_RE.sub("||", line)
        if "\t" in line:
            line = _TABS_RE.sub("\t", line.strip("\t"))
        line = _SPACES_RE.sub("  ", line)
        if _SEP_ONLY_RE.match(line) and not _MARKER_RE.match(line):
            # 分隔線（|---|---|、=====）與全空儲存格列：丟棄（以空行代替以保留段落邊界）
            out.append("")
            continue
        out.append(line)
    return _BLANK_LINES_RE.sub("\n\n", "\n".join(out)).strip()


def limit_text(text: str, max_chars: int = MAX_DOC_CHARS) -> tuple[str, bool]:
    """超過上限 → 只取前 max_chars 字（盡量在換行處截斷）。回傳 (文字, 是否截斷)。"""
    if max_chars <= 0 or len(text) <= max_chars:
        return text, False
    cut = text.rfind("\n", int(max_chars * 0.9), max_chars)
    return text[: cut if cut > 0 else max_chars], True


# ── 切段 ────────────────────────────────────────────────────────────────
def _is_table_line(line: str) -> bool:
    s = line.lstrip()
    return s.startswith("|") or line.count("\t") >= 2


def _breaks(text: str) -> tuple[list[int], list[int], list[tuple[int, int]]]:
    """回傳 (斷點位置, 斷點優先序, 表格列區間)。斷點位置 p 代表在 text[p] 之前切。"""
    pos: dict[int, int] = {}

    def add(p: int, prio: int):
        if 0 < p < len(text) and pos.get(p, 0) < prio:
            pos[p] = prio

    table_rows: list[tuple[int, int]] = []
    start = 0
    prev_blank = False
    for line in text.split("\n"):
        end = start + len(line)
        if _MARKER_RE.match(line):
            add(start, 4)
        elif prev_blank:
            add(start, 3)
        if _is_table_line(line):
            table_rows.append((start, end))
        else:
            for i, ch in enumerate(line):
                if ch in _SENT_END:
                    add(start + i + 1, 1)
        add(end + 1, 2)                       # 換行之後
        prev_blank = not line.strip()
        start = end + 1
    keys = sorted(pos)
    return keys, [pos[k] for k in keys], table_rows


def _row_end_containing(rows: list[tuple[int, int]], p: int) -> int | None:
    i = bisect.bisect_right(rows, (p, 1 << 62)) - 1
    if i >= 0 and rows[i][0] <= p < rows[i][1]:
        return rows[i][1] + 1
    return None


def _trim(text: str, s: int, e: int) -> tuple[int, int]:
    while s < e and text[s].isspace():
        s += 1
    while e > s and text[e - 1].isspace():
        e -= 1
    return s, e


def chunk_text(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[Chunk]:
    if not text or not text.strip():
        return []
    size = max(size, 50)
    overlap = max(0, min(overlap, size // 3))
    n = len(text)
    keys, prios, rows = _breaks(text)

    def best_break(lo: int, hi: int) -> int | None:
        """(lo, hi] 中優先序最高、同優先取最後的斷點。"""
        i, j = bisect.bisect_right(keys, lo), bisect.bisect_right(keys, hi)
        best, best_p = None, -1
        for k in range(i, j):
            if prios[k] >= best_p:
                best, best_p = keys[k], prios[k]
        return best

    spans: list[tuple[int, int]] = []
    start = 0
    while start < n:
        if n - start <= size:
            end = n
        else:
            hi = start + size
            end = best_break(start + size // 2, hi) or best_break(start + size // 5, hi)
            if end is None:
                row_end = _row_end_containing(rows, hi)
                end = row_end if row_end and row_end - start <= size * 3 else hi
        s, e = _trim(text, start, end)
        if e > s:
            spans.append((s, e))
        if end >= n:
            break
        # 重疊：從 end-overlap 之後第一個斷點開始；沒有斷點就不重疊
        nxt = end
        if overlap:
            i = bisect.bisect_left(keys, end - overlap)
            if i < len(keys) and start + (end - start) // 2 < keys[i] < end:
                nxt = keys[i]
        start = nxt
    return [Chunk(i, text[s:e], s, e) for i, (s, e) in enumerate(spans)]
