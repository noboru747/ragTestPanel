"""
敏感資料遮罩（純本機 regex，不呼叫任何 LLM / 外部 API）。

    masked_text, summary = mask_text(text)

summary 的 key 為英文類別（前端轉中文），value 為遮罩次數（出現次數，非唯一值數）：
    ip, mac, email, phone, national_id, credential, account, api_key, url_internal, person

同一份文件內相同的值會得到相同編號的佔位符，例如 【IP_1】、【帳號_2】，保留關聯性。
"""
from __future__ import annotations

import re
from typing import Callable

LABELS = {
    "ip": "IP",
    "mac": "MAC",
    "email": "EMAIL",
    "phone": "電話",
    "national_id": "身分證",
    "credential": "密碼",
    "account": "帳號",
    "api_key": "金鑰",
    "url_internal": "內部網址",
    "person": "人名",
}

# ASCII 英數邊界（Python 的 \b 會把中文當 \w，"身分證A123456789" 之間沒有 \b）
_NB = r"(?<![A-Za-z0-9])"
_NA = r"(?![A-Za-z0-9])"

_OCTET = r"(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)"
_IPV4 = rf"{_OCTET}(?:\.{_OCTET}){{3}}"


def _is_private_ipv4(ip: str) -> bool:
    try:
        a, b, *_ = (int(x) for x in ip.split("."))
    except ValueError:
        return False
    return (
        a == 10 or a == 127
        or (a == 172 and 16 <= b <= 31)
        or (a == 192 and b == 168)
        or (a == 169 and b == 254)
    )


LABEL_TO_CAT = {v: k for k, v in LABELS.items()}
PLACEHOLDER_RE = re.compile(r"【(" + "|".join(map(re.escape, LABELS.values())) + r")_(\d+)】")


def _norm_key(cat: str, value: str) -> str:
    """同值判斷用的正規化 key（email/MAC 不分大小寫、MAC/電話忽略分隔符號）"""
    key = value.strip()
    if cat in ("email", "mac", "url_internal"):
        key = key.lower()
    if cat == "mac":
        key = re.sub(r"[^0-9a-f]", "", key)
    if cat == "phone":
        key = re.sub(r"[^\d+]", "", key).replace("+886", "0")
    return key


class _Masker:
    def __init__(self, existing=None) -> None:
        # ids[cat][norm_key] = 編號；nexts[cat] = 下一個可用編號
        self.ids: dict[str, dict[str, int]] = {}
        self.nexts: dict[str, int] = {}
        self.summary: dict[str, int] = {}
        self.used: dict[str, dict] = {}       # placeholder → {placeholder, category, original, new}
        for m in existing or []:
            cat, original, ph = m["category"], m["original"], m["placeholder"]
            pm = PLACEHOLDER_RE.fullmatch(ph)
            if cat not in LABELS or not pm:
                continue
            n = int(pm.group(2))
            self.ids.setdefault(cat, {})[_norm_key(cat, original)] = n
            self.nexts[cat] = max(self.nexts.get(cat, 1), n + 1)

    def ph(self, cat: str, value: str, count_as: str | None = None) -> str:
        """cat 決定佔位符編號表；count_as 可讓 summary 記到別的類別（例如 URL 內的 IP 記為 url_internal）"""
        key = _norm_key(cat, value)
        table = self.ids.setdefault(cat, {})
        is_new = key not in table
        if is_new:
            n = self.nexts.get(cat, 1)
            table[key] = n
            self.nexts[cat] = n + 1
        if count_as != "":
            c = count_as or cat
            self.summary[c] = self.summary.get(c, 0) + 1
        placeholder = f"【{LABELS[cat]}_{table[key]}】"
        if placeholder not in self.used:
            self.used[placeholder] = {
                "placeholder": placeholder, "category": cat, "original": value.strip(), "new": is_new,
            }
        return placeholder


# ── 1. PEM 私鑰區塊 ────────────────────────────────────────────────────
_RE_PEM = re.compile(
    r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----.*?-----END [A-Z0-9 ]*PRIVATE KEY-----",
    re.S,
)

# ── 2. 內部網址 ───────────────────────────────────────────────────────
_INTERNAL_SUFFIX = r"(?:local|internal|lan|corp|intra|intranet|localdomain|home\.arpa)"
_RE_URL = re.compile(
    r"(?:https?|ftp|sftp|ssh|rdp|smb|ldaps?|jdbc:[a-z]+|mysql|postgres(?:ql)?|redis|mongodb)://"
    r"[^\s<>\"'，。；、）)】]+",
    re.I,
)
_RE_URL_HOST = re.compile(r"^[^:/]+://(?:[^@/\s]*@)?(\[[^\]]+\]|[^:/?#\s]+)(:\d+)?", re.I)
_RE_URL_PARTS = re.compile(r"^(?P<scheme>[^:/]+(?::[a-z]+)?://)(?:(?P<user>[^:@/\s]*)(?::(?P<pw>[^@/\s]*))?@)?(?P<host>\[[^\]]+\]|[^:/?#\s]+)(?P<rest>.*)$", re.I | re.S)
# 無 scheme 的內部主機：xxx.internal / xxx.local[:port]、localhost:port
_RE_BARE_INTERNAL = re.compile(
    rf"{_NB}(?P<host>(?:[A-Za-z0-9-]+\.)+{_INTERNAL_SUFFIX}{_NA}|localhost(?=:\d))(?P<rest>(?::\d{{1,5}})?)",
    re.I,
)


def _url_is_internal(url: str) -> bool:
    m = _RE_URL_HOST.match(url)
    if not m:
        return False
    host = m.group(1).strip("[]").lower()
    port = m.group(2)
    if host == "localhost" or re.search(rf"\.{_INTERNAL_SUFFIX}$", host):
        return True
    if re.fullmatch(_IPV4, host):
        return _is_private_ipv4(host)
    if ":" in host:  # IPv6
        return host in ("::1",) or host.startswith(("fe80", "fc", "fd"))
    # 帶 port 的單標籤主機名（無點）→ 內部主機，例如 http://fileserver:8080
    if port and "." not in host:
        return True
    return False


# ── 3. Email ──────────────────────────────────────────────────────────
_RE_EMAIL = re.compile(r"(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![A-Za-z0-9-])")

# ── 4. key-value：密碼 / 帳號 ──────────────────────────────────────────
_VAL = r"[A-Za-z0-9!@#$%^&*_+\-=.~/\\?{}\[\]:`]+"
_SEP = r"\s*(?:[:：=＝]|為|是)\s*"
_CRED_KEYS = (
    r"(?:(?<![A-Za-z])(?i:password|passwd|passphrase|pwd|pass|secret(?:[_-]?key)?|client[_-]?secret"
    r"|(?:access[_-]?|auth[_-]?|refresh[_-]?)?token|api[_-]?key|access[_-]?key|private[_-]?key|credentials?)(?![A-Za-z])"
    r"|密碼|密码|口令|通行碼|金鑰|私鑰|密鑰|PIN碼|驗證碼)"
)
_ACCT_KEYS = (
    r"(?:(?<![A-Za-z])(?i:account(?:[_ -]?(?:name|id))?|user(?:[_ -]?(?:name|id))?|login(?:[_ -]?(?:name|id))?|uid)(?![A-Za-z])"
    r"|使用者名稱|使用者帳號|使用者代號|登入帳號|登錄帳號|管理者帳號|管理員帳號|帳號|帳戶|帐号|帐户|帳号|账号|账户|用戶名|用户名)"  # 含簡體/混寫（tesseract chi_sim 常輸出簡體）
)
_RE_CRED = re.compile(rf"(?P<pre>{_CRED_KEYS}{_SEP}(?:[\"'])?(?:(?i:bearer)\s+)?)(?P<val>{_VAL})")
_RE_ACCT = re.compile(rf"(?P<pre>{_ACCT_KEYS}{_SEP}(?:[\"'])?)(?P<val>[A-Za-z0-9._@\\-]+)")

# ── 5. API key / token ────────────────────────────────────────────────
_RE_APIKEY = re.compile(
    rf"{_NB}(?:"
    r"sk-[A-Za-z0-9_-]{16,}"
    r"|AKIA[0-9A-Z]{16}"
    r"|gh[pousr]_[A-Za-z0-9]{30,}"
    r"|xox[abprs]-[A-Za-z0-9-]{10,}"
    r"|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}"
    r"|[0-9a-fA-F]{32,}"
    r"|[A-Za-z0-9+_-]{32,}={0,2}"   # 不含 "/"，避免跨 URL 路徑吃掉整段
    rf"){_NA}"
)


def _looks_like_token(s: str) -> bool:
    if re.fullmatch(r"[0-9a-fA-F]{32,}", s) or s.startswith(("sk-", "AKIA", "gh", "xox", "eyJ")):
        return True
    # 一般 base64 / 隨機字串：需同時含大寫、小寫、數字，避免把長英文字或路徑當 token
    return bool(re.search(r"[A-Z]", s) and re.search(r"[a-z]", s) and re.search(r"\d", s))


# ── 6. MAC ────────────────────────────────────────────────────────────
_RE_MAC = re.compile(
    rf"{_NB}(?:[0-9A-Fa-f]{{2}}([:-])(?:[0-9A-Fa-f]{{2}}\1){{4}}[0-9A-Fa-f]{{2}}"
    rf"|[0-9A-Fa-f]{{4}}\.[0-9A-Fa-f]{{4}}\.[0-9A-Fa-f]{{4}}){_NA}"
)

# ── 7. IP ─────────────────────────────────────────────────────────────
_RE_IPV4 = re.compile(rf"(?<![A-Za-z0-9_.]){_IPV4}(?:/(?:3[0-2]|[12]?\d))?(?![A-Za-z0-9_]|\.\d)")
_H = r"[0-9A-Fa-f]{1,4}"
_RE_IPV6 = re.compile(
    rf"(?<![A-Za-z0-9_:])(?:(?:{_H}:){{7}}{_H}|(?:{_H}:){{1,7}}:(?:{_H}(?::{_H}){{0,6}})?|::(?:{_H}(?::{_H}){{0,6}}))"
    rf"(?:/\d{{1,3}})?(?![A-Za-z0-9_:])"
)
_VERSION_CTX = re.compile(r"(?i)(?:v|ver\.?|version|rev\.?|build|版本|版號|版次|韌體|firmware)\s*[:：]?\s*$")
_SECTION_AFTER = re.compile(r"^\s*(?:節|條|章|項|款|版|點)")


def _skip_ipv4(m: re.Match) -> bool:
    s, start, end = m.string, m.start(), m.end()
    before = s[max(0, start - 15):start]
    if _VERSION_CTX.search(before) or before.endswith("第"):
        return True
    if _SECTION_AFTER.match(s[end:end + 3]):
        return True
    ip = m.group(0).split("/")[0]
    octs = [int(x) for x in ip.split(".")]
    if octs[0] == 0:
        return True
    # 行首章節編號：「3.1.2.1 系統架構」→ 各段都很小且後面接空白 + 中文
    line_start = s.rfind("\n", 0, start) + 1
    if not s[line_start:start].strip() and "/" not in m.group(0) and max(octs) <= 30:
        if re.match(r"\s+[一-鿿]", s[end:end + 3]):
            return True
    return False


# ── 8. 身分證 / 居留證 ─────────────────────────────────────────────────
_ID_LETTER = {
    "A": 10, "B": 11, "C": 12, "D": 13, "E": 14, "F": 15, "G": 16, "H": 17, "I": 34, "J": 18,
    "K": 19, "L": 20, "M": 21, "N": 22, "O": 35, "P": 23, "Q": 24, "R": 25, "S": 26, "T": 27,
    "U": 28, "V": 29, "W": 32, "X": 30, "Y": 31, "Z": 33,
}
_RE_NATID = re.compile(rf"{_NB}[A-Z](?:[1289]\d|[A-D]\d)\d{{7}}{_NA}")
_ID_CTX = re.compile(r"(?i)(?:身分證|身份證|統一證號|居留證|證號|ID)\s*(?:字號|號碼|號)?\s*[:：]?\s*$")


def _tw_id_checksum(v: str) -> bool:
    if not re.fullmatch(r"[A-Z]\d{9}", v):
        return False
    n = _ID_LETTER[v[0]]
    total = n // 10 + (n % 10) * 9
    digits = [int(c) for c in v[1:]]
    for w, d in zip(range(8, 0, -1), digits[:8]):
        total += w * d
    total += digits[8]
    return total % 10 == 0


def _is_natid(m: re.Match) -> bool:
    v = m.group(0)
    if _tw_id_checksum(v):
        return True
    before = m.string[max(0, m.start() - 12):m.start()]
    return bool(_ID_CTX.search(before))  # 舊式居留證 / 校驗碼不符但有明確語境


# ── 9. 電話 ───────────────────────────────────────────────────────────
_EXT = r"(?:\s*(?:#|轉|分機|ext\.?|x)\s*\d{1,5})?"
_RE_PHONE = re.compile(
    r"(?<![A-Za-z0-9_+])(?:"
    r"(?:\+886[-\s]?|\(\+886\)\s?)9\d{2}[-\s]?\d{3}[-\s]?\d{3}"             # +886 手機
    r"|09\d{2}[-\s]?\d{3}[-\s]?\d{3}"                                        # 手機
    r"|(?:\+886[-\s]?|\(\+886\)\s?)\(?[2-8]\d{0,2}\)?[-\s]?\d{3,4}[-\s]?\d{4}"  # +886 市話
    r"|\(0[2-8]\d{0,2}\)\s?\d{3,4}[-\s]?\d{4}"                              # (02)2345-6789
    r"|0[2-8]\d{0,2}[-\s]\d{3,4}[-\s]?\d{4}"                                 # 02-2345-6789
    rf"){_EXT}(?![A-Za-z0-9_])"
)
_RE_PHONE_CTX = re.compile(
    r"(?P<pre>(?:電話|手機|傳真|聯絡電話|市話|專線|(?<![A-Za-z])(?i:tel|phone|mobile|fax)(?![A-Za-z]))\s*[:：]?\s*)"
    r"(?P<val>0\d{8,9})(?!\d)"
)

# ── 10. 表格 / 清單 ──────────────────────────────────────────────────
# 表頭判斷用「包含」：帳號名稱、使用者帳號、Account Name… 都算；排除「帳號申請 / 帳號類型 / 帳號權限」這類非帳號值的欄
_HDR_ACCT_INC = re.compile(r"(?i)帳號|帳戶|帐号|帐户|账号|账户|使用者名稱|使用者代號|用戶名|用户名|登入名稱|account|user\s*name|username|user\s*id|userid|login")
_HDR_ACCT_EXACT = re.compile(r"(?i)^(?:user|uid|id)$")
_HDR_ACCT_EXC = re.compile(r"申請|說明|類型|類別|狀態|權限|日期|數量|筆數|用途|備註|停用|啟用|審查|覆核|管理辦法|type|status|date|count")
_HDR_CRED_INC = re.compile(r"(?i)密碼|密码|口令|password|passwd|pwd")
_HDR_CRED_EXC = re.compile(r"原則|規則|政策|期限|更新|變更|日期|長度|複雜|policy|expire|date|length")
_HDR_MAX_LEN = 16
_LIST_HDR = re.compile(r"(?i)^\s*(?:帳號|帳號清單|帳號列表|帳號名稱|使用者帳號|使用者清單|accounts?|usernames?|user\s*list)\s*[:：]?\s*$")
_LIST_ITEM = re.compile(r"^(\s*(?:[-*•‧·]|\d{1,3}[.)、])?\s*)([A-Za-z][A-Za-z0-9._\-]{1,63})(\s*)$")
# 表格欄位內的 ASCII token（含 DOMAIN\user、user@host、svc$）
_CELL_TOKEN = re.compile(r"(?<![A-Za-z0-9._@\$-])[A-Za-z0-9][A-Za-z0-9._@\$-]*[A-Za-z0-9$]|(?<![A-Za-z0-9])[A-Za-z]{2}(?![A-Za-z0-9])")
_CRED_TOKEN = re.compile(r"[!-~]+")


# ── 11. 人名 ─────────────────────────────────────────────────────────
_COMPOUND_SURNAMES = ("歐陽", "司馬", "諸葛", "上官", "范姜", "張簡", "張廖", "司徒", "東方", "公孫", "皇甫",
                      "端木", "令狐", "夏侯", "長孫", "慕容", "鍾離", "宇文", "尉遲", "呼延")
_SURNAMES = set(
    "陳林黃張李王吳劉蔡楊許鄭謝洪郭邱曾廖賴徐周葉蘇莊呂江何蕭羅高潘簡朱鍾游彭詹胡施沈余盧梁趙顏柯翁魏孫戴"
    "范方宋鄧杜傅侯曹薛丁卓阮馬董温溫唐藍石蔣古紀姚連馮歐程湯田康姜白汪鄒尤巫鐘黎涂凃龔嚴韓袁金童陸夏柳"
    "邵錢伍倪于譚駱熊任甘秦顧毛章史官萬俞雷粘饒殷池陶易凌喬季麥孔崔封賀龍葛閻華裴向雲尹包左車辜鄞褚宮"
    "聶冉賈利戚花岳竇莫房解應單邢湛祝甯寧闕練蒲郝鄔查佘樊管鮑艾武覃閔商"
)
_MASK_CH = "○Ｏ〇◯＊"
_NAME_CH = "[\u4e00-\u9fff" + _MASK_CH + "]"
_SURNAME_RE = "(?:" + "|".join(_COMPOUND_SURNAMES) + "|[" + "".join(sorted(_SURNAMES)) + "])"
_TITLES = ("先生", "小姐", "女士", "副總經理", "總經理", "董事長", "副處長", "處長", "副局長", "局長", "經理", "主任",
           "科長", "專員", "工程師", "技師", "組長", "課長", "協理", "老師", "博士", "教授", "律師", "法官", "院長",
           "庭長", "書記官", "執行秘書", "秘書", "股長", "副理", "襄理", "顧問", "委員")
_TITLE_RE = "(?:" + "|".join(sorted(_TITLES, key=len, reverse=True)) + ")"
_PERSON_KEYS = ("姓名", "聯絡人", "承辦人", "負責人", "窗口", "經辦人", "申請人", "填表人", "審核人", "核准人",
                "簽名", "報告人", "主持人", "專案經理", "督導人", "驗收人", "會辦人")
# 名字（不含姓）不會出現的字：避免「林務局主任」「高雄市」這類機關/地名/一般詞
_GIVEN_STOP = set("局處科部組室會司署院所課股隊系統資料管理中心公縣市區鄉鎮里路街號樓年月日時分秒期份次第元"
                  "案表單書函文件冊頁條款項之及與或和的是在為有於等各該本此其所以並以上下內外前後中人員者")
# 整詞排除：職稱、單位、以常見姓氏字開頭的一般詞
_PERSON_STOP = set("""
專案經理 系統管理 客家委員會 考生系統 管理者 使用者 承辦人 負責人 聯絡人 申請人 審核人 核准人 填表人 經辦人 主持人
簽名 姓名 先生 小姐 女士 同仁 全體 各位 本人 廠商 機關 主管 長官 單位 單一 應用 應該 利用 利益 方式 方案 方面 方法
金額 金融 金鑰 程式 程序 向上 向下 包含 包括 左右 車輛 雲端 任何 任務 章節 萬元 官方 連線 連結 周知 周邊 周全 周延
施工 施行 許可 許多 曾經 管道 管控 商業 商品 簡報 簡易 簡介 簡稱 高度 高級 高中 嚴重 嚴格 陸續 季度 查詢 查核 查看
解決 解析 練習 紀錄 紀要 尤其 溫度 藍牙 顏色 馬上 董事 張貼 謝謝 何況 陳列 陳述 陳報 陳核 黃色 白色 藍色 歐元
""".split())
_HDR_PERSON_INC = re.compile(r"(?i)姓名|人員|成員|聯絡人|承辦人|負責人|經辦人|申請人|填表人|審核人|核准人|專案經理|主持人|窗口")
_HDR_PERSON_EXACT = re.compile(r"(?i)^(?:PM|name)$")
_HDR_PERSON_EXC = re.compile(r"說明|欄位|類別|類型|數|編號|代號|權限|單位|職稱|電話|分機|email|信箱|帳號|日期|簽章|資格|性質|配置|身分|證號")
_RE_PERSON_FULL = re.compile("^" + _SURNAME_RE + _NAME_CH + "{1,2}$")
_RE_PERSON_MASKED = re.compile("^" + _NAME_CH + "*[" + _MASK_CH + "]" + _NAME_CH + "*$")   # 王○明
# ② 前後文：關鍵字 +（分隔）+ 人名；人名後須接非中文、結尾或稱謂
_NAME_END = "(?=[^\u4e00-\u9fff" + _MASK_CH + "]|$|" + _TITLE_RE + ")"
_RE_PERSON_KEY = re.compile(
    "(?:" + "|".join(_PERSON_KEYS) + r")\s*[:：]?\s*(?P<name>" + _SURNAME_RE + _NAME_CH + "{1,2})" + _NAME_END
)
_RE_PERSON_TITLE = re.compile("(?P<name>" + _SURNAME_RE + _NAME_CH + "{1,2})" + _TITLE_RE)


def _valid_person(name: str, require_surname: bool = True) -> bool:
    name = name.strip()
    if not (2 <= len(name) <= 4) or name in _PERSON_STOP:
        return False
    if not re.fullmatch(_NAME_CH + "+", name):
        return False
    if _RE_PERSON_MASKED.match(name):
        return len(set(name) - set(_MASK_CH)) >= 1   # 至少保留一個真字
    if require_surname and not _RE_PERSON_FULL.match(name):
        return False
    given = name[2:] if name[:2] in _COMPOUND_SURNAMES else name[1:]
    if any(ch in _GIVEN_STOP for ch in given):
        return False
    if any(name.endswith(t) for t in _TITLES):
        return False
    return True


# ②c 以空白分隔的人員表（docx/pdf 抽出的表格常變成「行政助理  王○明  前端工程師」）：
#     獨立 token 是完整人名，且同一行前/後一個 token 以職務詞結尾
_ROLE_END = re.compile(r"(?:工程師|設計師|設計|助理|經理|主任|專員|顧問|組長|科長|主持人|分析師|架構師|管理師|規劃師"
                       r"|管理員|人員|秘書|主管|技師|PM|SA|SD|QA)$")


def _find_person_role_tokens(text: str) -> set:
    # 以「全文空白分隔 token 序列」判斷鄰居（PDF 抽出的表格常一格一行，職務與人名在相鄰行）
    toks = text.split()
    found = set()
    for i, tok in enumerate(toks):
        if not _RE_PERSON_FULL.match(tok) or not _valid_person(tok):
            continue
        nb = [toks[j] for j in (i - 1, i + 1) if 0 <= j < len(toks)]
        if any(_ROLE_END.search(x) and not _RE_PERSON_FULL.match(x) for x in nb):
            found.add(tok)
    # 連續的人名（「行政助理  王○明  李○華  行政助理」）：與已找到的人名相鄰也算（一次擴散）
    extra = set()
    for i, tok in enumerate(toks):
        if tok in found:
            for j in (i - 1, i + 1):
                if 0 <= j < len(toks) and _RE_PERSON_FULL.match(toks[j]) and _valid_person(toks[j]):
                    extra.add(toks[j])
    return found | extra


def find_person_names_context(text: str) -> set:
    """② 前後文規則找到的人名（關鍵字 / 稱謂 / 空白分隔人員表）"""
    found = set()
    for pat in (_RE_PERSON_KEY, _RE_PERSON_TITLE):
        for m in pat.finditer(text):
            n = m.group("name")
            if _valid_person(n):
                found.add(n)
    return found | _find_person_role_tokens(text)


def _collect_person_cell(raw: str, persons: set, require_surname: bool = True) -> None:
    for part in re.split(r"[、,，/／;；\s]+", raw.strip()):
        part = part.strip("()（）")
        if part and _valid_person(part, require_surname):
            persons.add(part)


def find_person_names_table(text: str, require_surname: bool = True) -> set:
    """① 表格人名欄找到的人名（不遮罩，只回傳）"""
    persons: set = set()
    _mask_tables(text, _Masker(), persons, collect_only=True, require_surname=require_surname)
    return persons


def _header_cat(cell: str) -> str | None:
    c = cell.strip().rstrip("/／:：").strip()
    if not c or len(c) > _HDR_MAX_LEN:
        return None
    if _HDR_CRED_INC.search(c) and not _HDR_CRED_EXC.search(c):
        return "credential"
    if (_HDR_ACCT_INC.search(c) or _HDR_ACCT_EXACT.match(c)) and not _HDR_ACCT_EXC.search(c):
        return "account"
    if (_HDR_PERSON_INC.search(c) or _HDR_PERSON_EXACT.match(c)) and not _HDR_PERSON_EXC.search(c):
        return "person"
    return None


def _split_row(line: str) -> tuple[str, list[str]] | None:
    if "|" in line:
        return "|", line.split("|")
    if "\t" in line:
        return "\t", line.split("\t")
    return None


def _mask_cell(raw: str, cat: str, mk: "_Masker") -> str:
    if not raw.strip():
        return raw
    if cat == "credential":
        pat = _CRED_TOKEN
        return pat.sub(lambda m: m.group(0) if PLACEHOLDER_RE.search(m.group(0)) else mk.ph(cat, m.group(0)), raw)
    return _CELL_TOKEN.sub(lambda m: m.group(0) if m.group(0).isdigit() else mk.ph(cat, m.group(0)), raw)


def _mask_tables(text: str, mk: "_Masker", persons: set | None = None,
                 collect_only: bool = False, require_surname: bool = True) -> str:
    """
    表格欄位遮罩：
      - 表頭列任一儲存格「包含」帳號/密碼類欄名 → 鎖定該欄 index
      - 表頭可跨兩行（antiword 會把「帳號名|稱」斷到下一行）：與上一列同欄位數時合併判斷
      - 鎖定後，同分隔符號、同欄位數的後續列（含 antiword 的續行）該欄所有 ASCII token 皆遮罩
      - 遇到非表格行或欄位數改變即結束
    """
    lines = text.split("\n")
    out: list[str] = []
    cols: dict[int, str] = {}
    sep: str | None = None
    ncols = 0
    prev_cells: list[str] | None = None
    list_mode = False
    for line in lines:
        # ── 單欄帳號清單 ──
        if list_mode:
            mm = _LIST_ITEM.match(line)
            if mm:
                out.append(mm.group(1) + mk.ph("account", mm.group(2)) + mm.group(3))
                continue
            list_mode = False
        if _LIST_HDR.match(line):
            list_mode = True
            out.append(line)
            cols, sep, ncols, prev_cells = {}, None, 0, None
            continue

        row = _split_row(line)
        if row is None:
            cols, sep, ncols, prev_cells = {}, None, 0, None
            out.append(line)
            continue
        rsep, cells = row

        if cols and rsep == sep and len(cells) == ncols:
            if all(re.fullmatch(r"\s*:?-{2,}:?\s*|\s*", c) for c in cells):  # markdown 分隔列
                out.append(line)
                continue
            new = list(cells)
            for i, cat in cols.items():
                if cat == "person":
                    if persons is not None:   # 人名欄只收集，稍後全文擴散遮罩
                        _collect_person_cell(new[i], persons, require_surname)
                    continue
                if not collect_only:
                    new[i] = _mask_cell(new[i], cat, mk)
            out.append(rsep.join(new))
            continue

        # 尚未鎖定（或表格形狀改變）→ 偵測表頭
        cols, sep, ncols = {}, None, 0
        hdr = {i: c for i, cell in enumerate(cells) if (c := _header_cat(cell))}
        if not hdr and prev_cells is not None and len(prev_cells) == len(cells):
            hdr = {i: c for i, (a, b) in enumerate(zip(prev_cells, cells))
                   if (c := _header_cat(a.strip() + b.strip()))}
        if hdr:
            cols, sep, ncols = hdr, rsep, len(cells)
            prev_cells = None
        else:
            prev_cells = cells
        out.append(line)
    return "\n".join(out)


def _mask_persons(t: str, mk: "_Masker", persons: set) -> str:
    """① 表格人名欄 + ② 前後文 + 既有對照表的人名 → ③ 全文擴散遮罩（長名優先）"""
    names = set(persons) | find_person_names_context(t) | set(mk.ids.get("person", {}).keys())
    names = {n for n in names if len(n) >= 2}
    if not names:
        return t
    pat = re.compile("|".join(re.escape(n) for n in sorted(names, key=len, reverse=True)))
    return pat.sub(lambda m: mk.ph("person", m.group(0)), t)


def _sub(pattern: re.Pattern, text: str, fn: Callable[[re.Match], str]) -> str:
    return pattern.sub(fn, text)


def mask_text(text: str, existing=None, with_mappings: bool = False):
    """
    existing：既有對照表 [{placeholder, category, original}, ...]（專案範圍），同值沿用代號、新值接續編號。
    with_mappings=False → 回傳 (masked_text, summary)
    with_mappings=True  → 回傳 (masked_text, summary, mappings)，
        mappings = 本文件用到的所有代號 [{placeholder, category, original, new: bool}]
    """
    mk = _Masker(existing)
    if not text:
        return (text or "", {}, []) if with_mappings else (text or "", {})

    t = _sub(_RE_PEM, text, lambda m: mk.ph("api_key", m.group(0)))

    def host_ph(host: str) -> str:
        # 內部網址只替換主機部分，port / path 保留；IP 主機沿用 IP 編號表（與內文同一台主機同編號）
        h = host.strip("[]")
        if re.fullmatch(_IPV4, h) or ":" in h:
            return mk.ph("ip", h, count_as="url_internal")
        return mk.ph("url_internal", h)

    def url_fn(m: re.Match) -> str:
        url = m.group(0).rstrip(".,;:!?")
        tail = m.group(0)[len(url):]
        if not _url_is_internal(url):
            return m.group(0)
        p = _RE_URL_PARTS.match(url)
        if not p:
            return mk.ph("url_internal", url) + tail
        auth = ""
        if p.group("user") is not None:
            auth = mk.ph("account", p.group("user")) if p.group("user") else ""
            if p.group("pw"):
                auth += ":" + mk.ph("credential", p.group("pw"))
            auth += "@"
        return p.group("scheme") + auth + host_ph(p.group("host")) + p.group("rest") + tail

    t = _sub(_RE_URL, t, url_fn)
    t = _sub(_RE_BARE_INTERNAL, t, lambda m: host_ph(m.group("host")) + m.group("rest"))
    t = _sub(_RE_EMAIL, t, lambda m: mk.ph("email", m.group(0)))

    def kv(cat: str):
        def fn(m: re.Match) -> str:
            val = m.group("val").rstrip(".,;:")
            tail = m.group("val")[len(val):]
            if not val or set(val) <= {"*", "x", "X", "-", "."}:
                return m.group(0)
            return m.group("pre") + mk.ph(cat, val) + tail
        return fn

    t = _sub(_RE_CRED, t, kv("credential"))
    t = _sub(_RE_ACCT, t, kv("account"))
    t = _sub(_RE_APIKEY, t, lambda m: mk.ph("api_key", m.group(0)) if _looks_like_token(m.group(0)) else m.group(0))
    t = _sub(_RE_MAC, t, lambda m: mk.ph("mac", m.group(0)))
    t = _sub(_RE_IPV4, t, lambda m: m.group(0) if _skip_ipv4(m) else mk.ph("ip", m.group(0)))
    t = _sub(_RE_IPV6, t, lambda m: mk.ph("ip", m.group(0)) if m.group(0).count(":") >= 2 and m.group(0) != "::" else m.group(0))
    t = _sub(_RE_NATID, t, lambda m: mk.ph("national_id", m.group(0)) if _is_natid(m) else m.group(0))
    t = _sub(_RE_PHONE, t, lambda m: mk.ph("phone", m.group(0)))
    t = _sub(_RE_PHONE_CTX, t, lambda m: m.group("pre") + mk.ph("phone", m.group("val")))
    persons: set = set()
    t = _mask_tables(t, mk, persons)
    t = _mask_persons(t, mk, persons)
    if with_mappings:
        return t, dict(mk.summary), list(mk.used.values())
    return t, dict(mk.summary)


# ── 查詢端：問題遮罩 / 代號擷取 ────────────────────────────────────────
_CI_CATS = ("email", "url_internal", "mac")


def apply_known_mappings(text: str, mappings, categories=None) -> tuple[str, dict]:
    """
    以對照表原值掃描文字，出現就換成代號；單趟合併 regex（長字串優先，不會在已換上的代號內再匹配）。
    英數開頭/結尾的值加 ASCII 邊界（"qx0641" 不會誤換 "qx06412" 的一部分）；email/網址/MAC 不分大小寫。
    categories：只套用這些類別（None = 全部）。回傳 (新文字, {類別: 次數})
    """
    if not text or not mappings:
        return text, {}
    exact: dict[str, tuple] = {}
    lower: dict[str, tuple] = {}
    alts = []
    for m in sorted((m for m in mappings if m.get("original")), key=lambda m: len(m["original"]), reverse=True):
        cat, original = m["category"], m["original"]
        if categories and cat not in categories:
            continue
        pat = re.escape(original)
        if original[0].isascii() and original[0].isalnum():
            pat = r"(?<![A-Za-z0-9])" + pat
        if original[-1].isascii() and original[-1].isalnum():
            pat = pat + r"(?![A-Za-z0-9])"
        if cat in _CI_CATS:
            pat = "(?i:" + pat + ")"
            lower.setdefault(original.lower(), (m["placeholder"], cat))
        else:
            exact.setdefault(original, (m["placeholder"], cat))
        alts.append(pat)
    if not alts:
        return text, {}
    counts: dict[str, int] = {}

    def fn(mt: re.Match) -> str:
        v = mt.group(0)
        hit = exact.get(v) or lower.get(v.lower())
        if not hit:
            return v
        counts[hit[1]] = counts.get(hit[1], 0) + 1
        return hit[0]

    return re.sub("|".join(alts), fn, text), counts


def mask_question(question: str, mappings) -> tuple[str, int]:
    """以專案對照表原值把問題中的敏感值換成代號。回傳 (遮罩後問題, 替換次數)"""
    q, counts = apply_known_mappings(question, mappings)
    return q, sum(counts.values())


def extract_mappings(texts, mappings) -> list[dict]:
    """找出 texts 中出現的代號，回傳 [{placeholder, category, original}]（依出現順序、不重複）"""
    by_ph = {m["placeholder"]: m for m in mappings or []}
    seen: dict[str, dict] = {}
    for t in texts:
        for pm in PLACEHOLDER_RE.finditer(t or ""):
            ph = pm.group(0)
            if ph in by_ph and ph not in seen:
                m = by_ph[ph]
                seen[ph] = {"placeholder": ph, "category": m["category"], "original": m["original"]}
    return list(seen.values())
