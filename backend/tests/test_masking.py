"""
services/masking.py 單元測試。
容器內沒有 pytest 時可直接執行：python tests/test_masking.py
（也相容 pytest：pytest tests/test_masking.py）
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from services.masking import mask_text, mask_question, extract_mappings, apply_known_mappings  # noqa: E402


def m(text):
    return mask_text(text)


# ── 各類別 ──────────────────────────────────────────────────────────────
def test_ipv4_and_cidr():
    t, s = m("主機192.168.1.10，網段 10.0.0.0/24，對外 203.74.120.5")
    assert "192.168.1.10" not in t and "10.0.0.0/24" not in t and "203.74.120.5" not in t
    assert s["ip"] == 3
    assert "【IP_1】" in t and "【IP_2】" in t and "【IP_3】" in t


def test_ip_consistent_numbering():
    t, s = m("DB 在 10.1.1.5，備援 10.1.1.6；請連 10.1.1.5 的 5432 port")
    assert t.count("【IP_1】") == 2 and "【IP_2】" in t
    assert s["ip"] == 3


def test_ipv6():
    t, s = m("IPv6 位址 2001:db8:85a3::8a2e:370:7334 與 fe80::1")
    assert "2001:db8" not in t and "fe80::1" not in t
    assert s["ip"] == 2


def test_mac():
    t, s = m("網卡 00:1A:2B:3C:4D:5E、00-1a-2b-3c-4d-5e、Cisco 001a.2b3c.4d5e")
    assert s["mac"] == 3
    assert t.count("【MAC_1】") == 3  # 同一張網卡不同寫法 → 同編號


def test_email():
    t, s = m("聯絡人 wang.xm@court.gov.tw 或 Wang.XM@court.gov.tw")
    assert "@" not in t and s["email"] == 2 and t.count("【EMAIL_1】") == 2


def test_phone():
    t, s = m("手機 0912-345-678、0912345678，市話 (02)2834-1234 轉 123、02-2834-1234、+886 912 345 678，電話：0228341234")
    assert "0912" not in t and "2834" not in t and "+886" not in t
    assert s["phone"] == 6
    assert t.count("【電話_1】") == 3  # 0912-345-678 / 0912345678 / +886 912 345 678


def test_national_id():
    t, s = m("身分證字號 A123456789，居留證 AC01234567，新式居留證 A800000014")
    assert "A123456789" not in t and "AC01234567" not in t and "A800000014" not in t
    assert s["national_id"] == 3


def test_national_id_invalid_checksum_not_masked():
    t, s = m("料號 A123456780 規格")
    assert "A123456780" in t and "national_id" not in s


def test_credential_kv():
    t, s = m("password: P@ssw0rd!\n密碼：Abc12345\npwd=hunter2\n口令為 qwe123\ntoken: Bearer abcDEF123456")
    for v in ("P@ssw0rd!", "Abc12345", "hunter2", "qwe123", "abcDEF123456"):
        assert v not in t, v
    assert s["credential"] == 5
    assert "password: 【密碼_1】" in t


def test_credential_not_overmask_prose():
    t, s = m("密碼為每90天更換一次，密碼長度至少12碼。password is required.")
    assert "credential" not in s, t


def test_account_kv():
    t, s = m("帳號：admin\n使用者名稱: sysop01\nusername=root\n登入帳號：CORP\\wangxm\n帳號：admin")
    for v in ("sysop01", "root", "wangxm"):
        assert v not in t
    assert "admin" not in t
    assert s["account"] == 5 and t.count("【帳號_1】") == 2


def test_simplified_keys_from_ocr():
    t, s = m("里帐号 : admin01 密码 : Abc12345")
    assert "admin01" not in t and "Abc12345" not in t
    assert s["account"] == 1 and s["credential"] == 1


def test_api_keys():
    pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA1234\nabcd\n-----END RSA PRIVATE KEY-----"
    t, s = m(f"OpenAI sk-abcdefghijklmnop1234 AWS AKIAIOSFODNN7EXAMPLE\n{pem}\n雜湊 d41d8cd98f00b204e9800998ecf8427e\n"
             "token aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3z")
    assert "sk-abc" not in t and "AKIA" not in t and "PRIVATE KEY" not in t and "d41d8cd9" not in t and "aB3dE5" not in t
    assert s["api_key"] == 5


def test_url_internal():
    t, s = m("系統 http://10.0.0.5:8080/admin 、https://intranet.court.local/login、http://fileserver:9000、"
             "srv01.internal:5432、localhost:3000，公開網站 https://www.judicial.gov.tw/ 不遮")
    assert "10.0.0.5" not in t and "court.local" not in t and "fileserver" not in t and "srv01" not in t and "localhost" not in t
    assert "https://www.judicial.gov.tw/" in t
    assert s["url_internal"] == 5 and "ip" not in s


def test_url_internal_keeps_ip_relation_and_userinfo():
    t, s = m("SSH ssh://root:Pa55@10.0.0.9:22/home，備援主機同為 10.0.0.9；http://10.0.0.5/x?password=abc123")
    assert t.startswith("SSH ssh://【帳號_1】:【密碼_1】@【IP_1】:22/home")
    assert "備援主機同為 【IP_1】" in t           # URL 內與內文同一台主機 → 同編號
    assert "password=【密碼_2】" in t
    assert s["url_internal"] == 2 and s["ip"] == 1


def test_public_url_path_not_broken():
    t, s = m("https://cdn.example.com/assets/app.js 與 https://github.com/org/repo")
    assert s == {} and t.startswith("https://cdn.example.com/assets/app.js")


def test_table_account_column():
    text = ("| 帳號 | 姓名 | 權限 |\n"
            "|------|------|------|\n"
            "| admin | 王小明 | 管理員 |\n"
            "| user01 | 李大華 | 一般 |\n"
            "\n"
            "結尾 admin 再出現一次")
    t, s = m(text)
    assert "| 【帳號_1】 | 【人名_1】 |" in t and "| 【帳號_2】 | 【人名_2】 |" in t   # 姓名欄也遮人名
    assert "王小明" not in t and "管理員" in t and s["person"] == 2
    assert s["account"] == 2
    assert "結尾 admin" in t  # 表格外的一般字不遮（限制：只遮表格欄位內）


def test_table_tab_with_password_column():
    t, s = m("帳號\t密碼\t備註\nsysop\tS3cret!\t機房\nbackup\tB@ck2024\t備份")
    assert "sysop" not in t and "S3cret!" not in t and "B@ck2024" not in t and "機房" in t
    assert s["account"] == 2 and s["credential"] == 2


def test_single_column_account_list():
    t, s = m("帳號清單：\n- admin\n- operator01\n- auditor\n\n以上帳號每季覆核")
    assert "operator01" not in t and "auditor" not in t
    assert s["account"] == 3 and "以上帳號每季覆核" in t


# ── 誤判案例 ────────────────────────────────────────────────────────────
def test_no_false_positive_versions_dates_amounts():
    text = ("版本 v1.2.3，韌體 1.2.3.4，Python 3.11.4，比例 115.8，Windows 10.0.19045.3803\n"
            "日期 2026.01.01、2026/01/01、2026-01-01，民國112年3月15日\n"
            "金額 NT$ 1,250,000 元、新臺幣 385,000 元，數量 12,345\n"
            "依政府採購法第101條、第3.1.2.1節辦理\n"
            "3.1.2.1 系統架構\n"
            "契約編號 CW11105-111，統一編號 12345678，時間 12:30:45")
    t, s = m(text)
    assert s == {}, (s, t)
    assert t == text


def test_empty():
    assert mask_text("") == ("", {})


def test_performance():
    import time
    big = ("主機 192.168.1.10 帳號：admin 密碼：Abc123 聯絡 0912-345-678 a@b.com 一般內文說明文字。\n" * 2000)
    t0 = time.perf_counter()
    _, s = mask_text(big)
    dt = time.perf_counter() - t0
    assert s["ip"] == 2000 and dt < 3, dt


# ── antiword 表格（合成資料，仿「系統使用者帳號清單」格式）────────────────
ANTIWORD_TABLE = (
    "系統名稱： 測試系統(資料庫)\n"
    "|序號 |單位        |姓名   |帳號名稱                    |使用者權限/  |建立或更新日|備註          |\n"
    "|     |            |       |                            |使用者群組   |期          |              |\n"
    "|1    |系統本身帳  |系統本身帳|demoadmin                 |管理員       |115.08.01   |系統本身帳    |\n"
    "|     |號          |號     |                            |             |            |號            |\n"
    "|2    |維運廠商    |測試員 |op0001 (TESTDOM\\op0001)     |管理員       |115.08.01   |作業系統帳    |\n"
    "|     |            |       |                            |             |            |號已停用      |\n"
    "|3    |SQL         |       |NT SERVICE\\SQLTestAgent     |SQL應用程式帳號|115.08.01 |SQL本身創建的 |\n"
    "|     |            |       |                            |             |            |帳號          |\n"
    "|4    |系統        |系統   |svc_backup builtin          |管理員       |            |內建權限主    |\n"
    "\n"
    "備註：1.作業系統、資料庫之使用者帳號皆須列出審查。Windows Server 版本 2019。\n"
)


def test_antiword_account_table():
    t, s = m(ANTIWORD_TABLE)
    for v in ("demoadmin", "op0001", "TESTDOM", "SQLTestAgent", "svc_backup", "builtin"):
        assert v not in t, v
    # 非帳號欄不動：單位 SQL、權限、日期、備註（含「帳號」續行不可被當成新表頭）
    assert "|SQL         |" in t and "115.08.01" in t and "Windows Server" in t
    assert "|號已停用      |" in t
    assert s["account"] >= 6


def test_header_contains_and_exclusions():
    t, s = m("| 使用者帳號 | 帳號類型 | 預設密碼 | 密碼原則 |\n| alice01 | personal | Init@123 | strong |")
    assert "alice01" not in t and "Init@123" not in t
    assert "personal" in t and "strong" in t
    assert s["account"] == 1 and s["credential"] == 1


def test_header_split_across_lines():
    t, s = m("|序號|帳號名|姓名|\n|    |稱    |    |\n|1   |bob99 |王  |")
    assert "bob99" not in t and s["account"] == 1


# ── 專案範圍代號延續 ────────────────────────────────────────────────────
def test_project_scope_numbering():
    t1, s1, maps1 = mask_text("主機 10.0.0.1 帳號：alice", with_mappings=True)
    assert all(mp["new"] for mp in maps1)
    existing = [{k: mp[k] for k in ("placeholder", "category", "original")} for mp in maps1]
    t2, s2, maps2 = mask_text("主機 10.0.0.2 與 10.0.0.1，帳號：bob", existing=existing, with_mappings=True)
    assert "【IP_1】" in t2 and "【IP_2】" in t2 and "帳號：【帳號_2】" in t2
    flags = {mp["placeholder"]: mp["new"] for mp in maps2}
    assert flags == {"【IP_1】": False, "【IP_2】": True, "【帳號_2】": True}


def test_existing_with_gaps_continues_after_max():
    existing = [{"placeholder": "【IP_5】", "category": "ip", "original": "10.9.9.9"}]
    t, _ = mask_text("10.1.1.1 / 10.9.9.9", existing=existing)
    assert t == "【IP_6】 / 【IP_5】"


# ── 查詢端 ──────────────────────────────────────────────────────────────
MAPS = [
    {"placeholder": "【IP_1】", "category": "ip", "original": "10.0.0.1"},
    {"placeholder": "【帳號_1】", "category": "account", "original": "qx0641"},
    {"placeholder": "【帳號_2】", "category": "account", "original": "TESTDOM\\qx0641"},
    {"placeholder": "【EMAIL_1】", "category": "email", "original": "a.b@court.gov.tw"},
]


def test_mask_question_longest_first_and_boundaries():
    q, n = mask_question("TESTDOM\\qx0641 和 qx0641 在 10.0.0.1 嗎？qx06412 不是；10.0.0.10 也不是；寄 A.B@court.gov.tw", MAPS)
    assert q == "【帳號_2】 和 【帳號_1】 在 【IP_1】 嗎？qx06412 不是；10.0.0.10 也不是；寄 【EMAIL_1】"
    assert n == 4


def test_mask_question_no_mappings():
    assert mask_question("一般問題", []) == ("一般問題", 0)


def test_extract_mappings():
    got = extract_mappings(["答案提到【帳號_1】與【IP_1】", "片段【IP_1】、【文件：x.doc】、【IP_99】"], MAPS)
    assert got == [
        {"placeholder": "【帳號_1】", "category": "account", "original": "qx0641"},
        {"placeholder": "【IP_1】", "category": "ip", "original": "10.0.0.1"},
    ]


def test_rag_prompt_has_mask_note():
    import importlib
    try:
        q = importlib.import_module("routers.query")
    except ModuleNotFoundError:  # 主機沒有後端依賴時略過
        return
    p = q.build_rag_prompt("【文件：a】\n內容【IP_1】", "【IP_1】是哪台？")
    assert "遮罩代號" in p and "原樣保留代號" in p and "【IP_1】是哪台？" in p


# ── 人名（合成資料）────────────────────────────────────────────────────
def test_person_table_column_and_diffusion():
    text = ("|序號|單位    |姓名   |帳號名稱 |\n"
            "|1   |維運廠商|林○華 |op01     |\n"
            "|2   |資訊室  |張雅婷 |ops02    |\n"
            "|3   |系統    |系統   |svc      |\n"
            "\n本案由張雅婷負責維運，林○華協助。")
    t, s = m(text)
    assert "張雅婷" not in t and "林○華" not in t
    assert t.count("【人名_2】") == 2 or t.count("【人名_1】") == 2
    assert "|系統   |" in t            # 非人名（姓氏表外）不遮
    assert s["person"] == 4 and s["account"] == 3


def test_person_context_keys_and_titles():
    t, s = m("承辦人：陳志明　科室主管：\n聯絡人 吳佩珊（分機 123）\n請洽李建國經理或歐陽娜娜小姐。")
    for n in ("陳志明", "吳佩珊", "李建國", "歐陽娜娜"):
        assert n not in t, n
    assert s["person"] == 4


def test_person_role_token_table():
    t, s = m("職稱  姓名\n行政助理\n許雅雯\n周子豪\n行政助理\n前端工程師  鄭宇翔")
    for n in ("許雅雯", "周子豪", "鄭宇翔"):
        assert n not in t, n


def test_person_exclusions():
    text = ("專案經理負責系統管理，客家委員會考生系統由林務局主任協調。"
            "高雄市政府、方案說明、應用程式、程式設計師、金額新臺幣100元。"
            "承辦人：簽名　負責人：系統管理")
    t, s = m(text)
    assert "person" not in s, (s, t)


def test_person_existing_mapping_diffuses():
    existing = [{"placeholder": "【人名_3】", "category": "person", "original": "黃怡君"}]
    t, s, maps = mask_text("會議紀錄：黃怡君報告進度；新同仁 蔡明宏工程師", existing=existing, with_mappings=True)
    assert "【人名_3】報告進度" in t and "【人名_4】工程師" in t
    assert {mp["placeholder"]: mp["new"] for mp in maps} == {"【人名_3】": False, "【人名_4】": True}


def test_person_question_mask():
    maps = [{"placeholder": "【人名_1】", "category": "person", "original": "張雅婷"},
            {"placeholder": "【人名_2】", "category": "person", "original": "張雅"}]
    q, n = mask_question("張雅婷和張雅是同一人嗎？", maps)
    assert q == "【人名_1】和【人名_2】是同一人嗎？" and n == 2


# ── 重掃（補遮）──────────────────────────────────────────────────────────
def test_rescan_apply_known_mappings():
    maps = [{"placeholder": "【人名_1】", "category": "person", "original": "張雅婷"},
            {"placeholder": "【IP_1】", "category": "ip", "original": "10.0.0.1"},
            {"placeholder": "【帳號_1】", "category": "account", "original": "op01"}]
    already = "先前上傳：張雅婷維護 【IP_1】，備援 10.0.0.1；帳號 op01、op011 不同"
    t, counts = apply_known_mappings(already, maps)
    assert t == "先前上傳：【人名_1】維護 【IP_1】，備援 【IP_1】；帳號 【帳號_1】、op011 不同"
    assert counts == {"person": 1, "ip": 1, "account": 1}
    t2, c2 = apply_known_mappings(already, maps, categories={"person"})
    assert c2 == {"person": 1} and "10.0.0.1" in t2
    # 冪等：再跑一次不再替換
    assert apply_known_mappings(t, maps) == (t, {})


def test_rescan_never_matches_inside_placeholder():
    maps = [{"placeholder": "【IP_1】", "category": "ip", "original": "10.0.0.1"},
            {"placeholder": "【帳號_9】", "category": "account", "original": "IP"}]
    t, counts = apply_known_mappings("10.0.0.1 與 IP", maps)
    assert t == "【IP_1】 與 【帳號_9】" and counts == {"ip": 1, "account": 1}


if __name__ == "__main__":
    tests = [(k, v) for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for name, fn in tests:
        try:
            fn()
            print(f"PASS {name}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL {name}: {e}")
        except Exception as e:
            failed += 1
            print(f"ERROR {name}: {type(e).__name__}: {e}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    sys.exit(1 if failed else 0)
