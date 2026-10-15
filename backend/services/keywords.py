"""
中文關鍵字檢索（應用層斷詞）：中文二元組（bigram）+ 英數詞 → PostgreSQL tsvector / tsquery（'simple' 設定）。

PostgreSQL 內建 parser 不會切中文（一整串中文是一個 token），pg_trgm 對 2 字中文詞幾乎無效
（比較結果見回報 / scripts/eval_retrieval.py），因此改在應用層產生詞彙：
  文件：「駐點人員應遵守」→ 駐點 點人 人員 員應 應遵 遵守
  查詢：「駐點人員」      → 駐點 <-> 點人 <-> 人員（同一詞的二元組須相鄰＝片語），不同詞之間 OR
存入 document_chunks.keywords_tsv = to_tsvector('simple', '<以空白串接的詞彙>')。
"""
from __future__ import annotations

import re
import unicodedata

_CJK = r"㐀-䶿一-鿿豈-﫿"
_TOKEN_RE = re.compile(rf"[{_CJK}]+|[a-z0-9]+(?:[._\-][a-z0-9]+)*")
_PLACEHOLDER_RE = re.compile(r"【[^】]{1,20}】")

# 查詢時忽略的常見疑問 / 功能詞二元組（文件端照常索引）
_QUERY_STOP = {
    "什麼", "多少", "是否", "哪些", "哪個", "如何", "為何", "請問", "有沒", "沒有", "是多", "是什",
    "的是", "是哪", "有哪", "有多", "要求", "規定", "相關", "內容", "說明", "資料", "一下", "可以",
    "應該", "需要", "關於", "怎麼", "幾個", "幾位", "幾人", "為多",
}
_STOP_CHARS = set("的了嗎呢吧啊與及或和是在有為")


def _norm(text: str) -> str:
    return unicodedata.normalize("NFKC", text or "").lower()


def _tokens(text: str) -> list[str]:
    # 遮罩代號（【IP_1】）不當關鍵字
    return _TOKEN_RE.findall(_PLACEHOLDER_RE.sub(" ", _norm(text)))


def _is_cjk(tok: str) -> bool:
    return bool(re.match(rf"[{_CJK}]", tok))


def _bigrams(run: str) -> list[str]:
    if len(run) == 1:
        return [run]
    return [run[i:i + 2] for i in range(len(run) - 1)]


def document_terms(text: str) -> list[str]:
    """文件端詞彙（保留順序與重複，供 ts_rank 計算詞頻）。"""
    terms: list[str] = []
    for tok in _tokens(text):
        if _is_cjk(tok):
            terms.extend(_bigrams(tok))
        else:
            terms.append(tok)
    return terms


def document_keyword_text(text: str) -> str:
    """給 to_tsvector('simple', :kw) 用的字串。"""
    return " ".join(document_terms(text))


MAX_GROUP_BIGRAMS = 6   # 一組最多 6 個二元組（約 7 個字）視為片語；更長的連續中文切成重疊視窗，避免長句過嚴


def _cjk_groups(run: str) -> list[list[str]]:
    """把一段連續中文切成數組二元組：去掉停用二元組 / 含功能字的二元組，以及與停用二元組重疊的鄰居。"""
    if len(run) < 2:
        return []
    grams = _bigrams(run)
    bad = [g in _QUERY_STOP or g[0] in _STOP_CHARS or g[1] in _STOP_CHARS for g in grams]
    drop = list(bad)
    for i, g in enumerate(grams):
        if g in _QUERY_STOP:            # 停用詞的前後鄰居二元組會跨到停用字 → 一併丟掉
            if i > 0:
                drop[i - 1] = True
            if i + 1 < len(grams):
                drop[i + 1] = True
    groups: list[list[str]] = []
    cur: list[str] = []
    for g, d in zip(grams, drop):
        if d:
            if cur:
                groups.append(cur)
            cur = []
        else:
            cur.append(g)
    if cur:
        groups.append(cur)
    out: list[list[str]] = []
    for grp in groups:
        if len(grp) <= MAX_GROUP_BIGRAMS:
            out.append(grp)
            continue
        step = MAX_GROUP_BIGRAMS - 1          # 視窗間共用一個二元組，不留下孤立的短尾巴
        for i in range(0, len(grp) - 1, step):
            out.append(grp[i:i + MAX_GROUP_BIGRAMS])
    return out


def query_groups(question: str) -> list[list[str]]:
    """查詢端：每個詞一組（中文詞的二元組一組，組內 AND），已去除疑問 / 功能詞。"""
    groups: list[list[str]] = []
    seen: set[tuple[str, ...]] = set()
    for tok in _tokens(question):
        cand = _cjk_groups(tok) if _is_cjk(tok) else ([[tok]] if (len(tok) >= 2 or tok.isdigit()) else [])
        for g in cand:
            key = tuple(g)
            if key not in seen:
                seen.add(key)
                groups.append(g)
    return groups


def _quote(term: str) -> str:
    return "'" + term.replace("'", "''").replace("\\", "") + "'"


def build_tsquery(question: str) -> str:
    """'simple' to_tsquery 字串；組內以 <-> 相鄰（等同片語，文件端二元組位置連續）、組間 OR。沒有可用詞彙回傳空字串。"""
    parts = []
    for g in query_groups(question):
        parts.append("(" + " <-> ".join(_quote(t) for t in g) + ")" if len(g) > 1 else _quote(g[0]))
    return " | ".join(parts)
