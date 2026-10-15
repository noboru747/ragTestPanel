"""
脫敏基準測試用「虛構」文件產生器（全部隨機生成，不取自任何真實文件或資料庫）。

    python gen_fake_docs.py [--seed 20261013] [--out data]

輸出：
    data/docs/<doc_id>.txt
    data/ground_truth.json   [{doc_id, type, chars, sensitive:[{text,category}], non_sensitive:[{text,kind}]}]

虛構規則：
    人名 = 常見姓 + 不常見名字字元隨機組合；身分證 = 正確檢查碼假號；手機 09xx 隨機；
    Email 只用 example.com / example.org / example.net；IP 只用 10.x / 192.168.x；銀行帳號隨機。
    公司名稱為虛構；法院 / 公部門名稱為公開機關名（標為 non_sensitive 干擾項）。
"""
from __future__ import annotations

import argparse
import json
import random
import string
from pathlib import Path

CATS = ["person", "national_id", "phone", "email", "address", "birth_date", "bank_account",
        "salary", "ip", "url_internal", "account", "credential"]

SURNAMES = list("陳林黃張李王吳劉蔡楊許鄭謝郭洪曾邱廖賴周徐葉蘇莊呂江何蕭羅高潘簡朱鍾彭詹胡施沈余盧梁趙顏柯翁魏")
# 不常見名字用字（隨機兩兩組合，降低與真人重名機率）
GIVEN_CH = list("澂翊蓁諭珮暄彧璟芃湉霈澔昀筠綺甯皓瑀妘禕緹嵐朔玹靚舫謙紘曜渟岑沅璇蘅昕棠韞瀅馥羿琤")
COMPANIES = ["晨曦數位科技股份有限公司", "北辰系統整合有限公司", "藍岫資訊服務股份有限公司", "雲杉網路工程有限公司"]
ROADS = ["文化路", "中正路", "民生東路", "復興北路", "仁愛路", "中山路", "建國南路", "和平東路", "成功路", "光復路"]
CITIES = [("臺北市", ["大安區", "中山區", "信義區", "松山區"]), ("新北市", ["板橋區", "中和區", "新店區", "三重區"]),
          ("桃園市", ["中壢區", "桃園區", "龜山區"]), ("臺中市", ["西屯區", "北屯區", "南屯區"]),
          ("高雄市", ["苓雅區", "左營區", "三民區"])]
SCHOOLS = ["國立某某大學資訊工程學系", "私立某某科技大學資訊管理系", "國立某某大學電機工程研究所"]
ID_LETTER = {"A": 10, "B": 11, "C": 12, "D": 13, "E": 14, "F": 15, "G": 16, "H": 17, "J": 18, "K": 19,
             "L": 20, "M": 21, "N": 22, "P": 23, "Q": 24, "R": 25, "S": 26, "T": 27, "U": 28, "V": 29}


class Gen:
    def __init__(self, seed: int):
        self.r = random.Random(seed)
        self.used_names: set[str] = set()

    def name(self) -> str:
        while True:
            n = self.r.choice(SURNAMES) + "".join(self.r.sample(GIVEN_CH, 2))
            if n not in self.used_names:
                self.used_names.add(n)
                return n

    def natid(self) -> str:
        L = self.r.choice(list(ID_LETTER))
        d = [self.r.choice([1, 2])] + [self.r.randint(0, 9) for _ in range(7)]
        n = ID_LETTER[L]
        total = n // 10 + (n % 10) * 9 + sum(w * x for w, x in zip(range(8, 0, -1), d))
        check = (10 - total % 10) % 10
        return L + "".join(map(str, d)) + str(check)

    def mobile(self, style: int | None = None) -> str:
        p = "09" + "".join(str(self.r.randint(0, 9)) for _ in range(8))
        style = self.r.randint(0, 2) if style is None else style
        return [p, f"{p[:4]}-{p[4:7]}-{p[7:]}", f"{p[:4]} {p[4:7]} {p[7:]}"][style]

    def landline(self, ext: bool = False) -> str:
        s = f"(02){self.r.randint(2,8)}{self.r.randint(100,999)}-{self.r.randint(1000,9999)}"
        return s + (f"#{self.r.randint(100,899)}" if ext else "")

    def email(self, name_hint: str = "") -> str:
        user = self.r.choice(["", "a.", "j", "tw."]) + "".join(self.r.choices(string.ascii_lowercase, k=self.r.randint(4, 7)))
        user += str(self.r.randint(1, 99)) if self.r.random() < 0.5 else ""
        return f"{user}@{self.r.choice(['example.com', 'example.org', 'example.net'])}"

    def address(self) -> str:
        city, dists = self.r.choice(CITIES)
        a = f"{city}{self.r.choice(dists)}{self.r.choice(ROADS)}"
        if self.r.random() < 0.5:
            a += self.r.choice(["一", "二", "三"]) + "段"
        if self.r.random() < 0.5:
            a += f"{self.r.randint(2, 300)}巷"
        a += f"{self.r.randint(1, 200)}號"
        if self.r.random() < 0.7:
            a += f"{self.r.randint(2, 15)}樓"
        return a

    def birth(self) -> str:
        y, m, d = self.r.randint(65, 90), self.r.randint(1, 12), self.r.randint(1, 28)
        return self.r.choice([f"民國{y}年{m}月{d}日", f"{y+1911}/{m:02d}/{d:02d}", f"{y}.{m:02d}.{d:02d}"])

    def bank(self) -> str:
        return self.r.choice([
            f"{self.r.randint(100,999)}-{self.r.randint(10,99)}-{self.r.randint(100000,999999)}-{self.r.randint(0,9)}",
            "".join(str(self.r.randint(0, 9)) for _ in range(14)),
            f"{self.r.randint(1000,9999)}-{self.r.randint(100,999)}-{self.r.randint(100000,999999)}",
        ])

    def money(self, lo: int, hi: int) -> str:
        return f"{self.r.randrange(lo, hi, 10):,}"

    def ip(self) -> str:
        if self.r.random() < 0.5:
            return f"10.{self.r.randint(0,255)}.{self.r.randint(0,255)}.{self.r.randint(2,254)}"
        return f"192.168.{self.r.randint(0,255)}.{self.r.randint(2,254)}"

    def acct(self) -> str:
        return self.r.choice([
            "".join(self.r.choices(string.ascii_lowercase, k=self.r.randint(3, 5))) + str(self.r.randint(1, 99)),
            "".join(self.r.choices(string.ascii_lowercase, k=2)) + "." + "".join(self.r.choices(string.ascii_lowercase, k=self.r.randint(3, 6))),
            self.r.choice(["svc_", "adm_", "ap_"]) + "".join(self.r.choices(string.ascii_lowercase, k=4)),
        ])

    def password(self) -> str:
        pool = string.ascii_letters + string.digits
        s = "".join(self.r.choices(pool, k=self.r.randint(8, 11)))
        return s[:3] + self.r.choice("!@#$%&*") + s[3:]


class Doc:
    def __init__(self, doc_id: str, dtype: str):
        self.id, self.type = doc_id, dtype
        self.buf: list[str] = []
        self.gold: dict[tuple[str, str], None] = {}
        self.ns: dict[tuple[str, str], None] = {}

    def S(self, text: str, cat: str) -> str:
        assert cat in CATS, cat
        self.gold[(text, cat)] = None
        return text

    def N(self, text: str, kind: str = "non_sensitive") -> str:
        self.ns[(text, kind)] = None
        return text

    def w(self, s: str = "") -> None:
        self.buf.append(s)

    def text(self) -> str:
        return "\n".join(self.buf).strip() + "\n"


FILLER = [
    "本案依契約規定辦理，相關文件已併同送審並存檔備查。",
    "如有疑義，請逕洽承辦單位，俾利後續作業之推動。",
    "各項作業時程依專案管理計畫書所訂里程碑執行，進度符合預期。",
    "系統維運期間如遇異常狀況，應即通報並記錄處理過程。",
    "相關佐證資料彙整於附件，敬請 鑒核。",
    "前述事項已於工作會議中確認，後續將持續追蹤辦理情形。",
    "為確保系統穩定運作，廠商應每月提交維運報告，內容包含異常事件、處理經過、改善措施及後續預防作為。",
    "有關資訊安全管理，應依資通安全管理法及其子法規定辦理，並配合機關年度稽核作業提供必要之佐證資料。",
    "本期間各項服務可用率均達契約要求之百分之九十九點五以上，未發生重大服務中斷事件。",
    "如需調整作業時程，應於七日前以書面敘明理由提出申請，經機關同意後始得變更。",
    "人員教育訓練每半年辦理一次，課程內容涵蓋系統操作、個資保護及社交工程防範等主題。",
    "針對使用者反映之操作問題，已彙整常見問答並更新於系統說明文件，供同仁自行查閱。",
    "所有異動作業均須填具變更申請單，經主管核可後於非上班時段執行，並保留回復計畫。",
    "本案驗收文件包含系統操作手冊、維護手冊、測試報告及原始程式碼光碟各乙份。",
    "資料備份採每日增量、每週完整之策略，備份媒體另存放於異地機房，以降低災害風險。",
    "若發生資安事件，應於一小時內通報機關資安窗口，並依事件等級啟動應變程序。",
    "廠商派駐人員應遵守機關門禁管理規定，進出機房須登記並由機關人員陪同。",
    "前揭費用均已含稅，並依政府採購法相關規定辦理付款作業。",
]


def para(g: "Gen", d: "Doc", n: int) -> None:
    for x in g.r.sample(FILLER, n):
        d.w(x)


def doc_attendance(g: Gen) -> Doc:
    d = Doc("d01_attendance", "差勤表")
    co = g.r.choice(COMPANIES)
    d.w(f"{d.N(co, 'org')}　115年9月份員工差勤紀錄表")
    d.w(f"製表日期：115年10月1日　　表單版本：{d.N('v2.3.1', 'version')}")
    d.w("")
    staff = [(g.name(), f"E{g.r.randint(1000,9999)}") for _ in range(6)]
    for nm, eid in staff:
        d.w(f"姓名：{d.S(nm, 'person')}　員工編號：{eid}　部門：{g.r.choice(['系統開發部', '維運服務部', '專案管理室'])}")
        d.w("日期　　| 上班刷卡 | 下班刷卡 | 備註")
        for day in range(1, 13):
            a = f"08:{g.r.randint(20,59):02d}"
            b = f"{g.r.choice([17,18,19])}:{g.r.randint(0,59):02d}"
            note = g.r.choice(["", "", "", "外出洽公", "加班1小時", "特休半日", "忘刷卡補登"])
            d.w(f"9/{day:02d}　| {a}　| {b}　| {note}")
        d.w(f"本月遲到 {g.r.randint(0,3)} 次，請假 {g.r.randint(0,2)} 日。")
        d.w("")
    sup = g.name()
    d.w(f"部門主管核章：{d.S(sup, 'person')}　　人資承辦：{d.S(g.name(), 'person')}")
    d.w(f"備註：依{d.N('勞動基準法第30條', 'law')}規定，出勤紀錄保存五年。")
    return d


def doc_payroll(g: Gen) -> Doc:
    d = Doc("d02_payroll", "薪資請款明細")
    co = g.r.choice(COMPANIES)
    d.w(f"{d.N(co, 'org')}　專案人力費用請款明細（115年第3季）")
    d.w(f"契約編號：{d.N('PRJ-115-0087', 'contract_no')}　契約總價：新臺幣{d.N('3,860,000', 'contract_amount')}元")
    d.w("")
    d.w("一、人員薪資明細")
    d.w("職稱 | 姓名 | 月薪 | 勞保自付額 | 健保自付額 | 勞退提繳 | 實領金額")
    for title in ["專案經理", "系統分析師", "資深工程師", "工程師", "工程師", "行政助理"]:
        nm = g.name()
        sal = g.r.randrange(36000, 98000, 100)
        lab, hea, pen = int(sal * 0.023), int(sal * 0.0155), int(sal * 0.06)
        row = [title, d.S(nm, "person"), d.S(f"{sal:,}", "salary"), d.S(f"{lab:,}", "salary"),
               d.S(f"{hea:,}", "salary"), d.S(f"{pen:,}", "salary"), d.S(f"{sal-lab-hea:,}", "salary")]
        d.w(" | ".join(row))
    d.w("")
    d.w("二、加班費明細")
    for _ in range(4):
        nm = g.name()
        hrs = g.r.randint(4, 30)
        d.w(f"  {d.S(nm, 'person')}　加班 {hrs} 小時，加班費 {d.S(f'{hrs * g.r.randint(250, 420):,}', 'salary')} 元（依平日加班費率計算）")
    d.w("")
    d.w("三、說明")
    d.w("1. 本期請款期間為115年7月1日至115年9月30日，共計三個月。")
    d.w(f"2. 依契約{d.N('第5條第2項', 'clause')}，人力費用按月核實計價，加班費另計。")
    d.w("3. 勞保、健保及勞退提繳金額依勞動部公告之投保級距計算。")
    d.w(f"4. 本期請款總額新臺幣{d.N('965,000', 'contract_amount')}元，未超過契約總價。")
    d.w("")
    d.w(f"製表人：{d.S(g.name(), 'person')}　　會計：{d.S(g.name(), 'person')}")
    para(g, d, 9)
    return d


def doc_resume(g: Gen) -> Doc:
    d = Doc("d03_resume", "個人履歷")
    nm = g.name()
    d.w("個人履歷表")
    d.w("")
    d.w(f"姓名：{d.S(nm, 'person')}")
    d.w(f"出生日期：{d.S(g.birth(), 'birth_date')}")
    d.w(f"手機：{d.S(g.mobile(1), 'phone')}")
    d.w(f"E-mail：{d.S(g.email(), 'email')}")
    d.w(f"通訊地址：{d.S(g.address(), 'address')}")
    d.w(f"期望月薪：{d.S('5' + g.money(2000, 9000).replace(',', '')[:1] + ',000', 'salary')}元（可議）")
    d.w("")
    d.w("【學歷】")
    d.w(f"  {g.r.choice(SCHOOLS)}　碩士　{g.r.randint(2008,2014)}年畢業")
    d.w(f"  {g.r.choice(SCHOOLS)}　學士　{g.r.randint(2004,2008)}年畢業")
    d.w("")
    d.w("【工作經歷】")
    for co in g.r.sample(COMPANIES, 3):
        d.w(f"  {d.N(co, 'org')}　{g.r.choice(['資深工程師', '系統分析師', '技術主任'])}　{g.r.randint(2012,2022)}年起")
        d.w("    負責政府機關資訊系統開發與維運，包含需求訪談、系統設計、資料庫調校及上線後之維護作業。")
        d.w("    參與跨部門協作，導入持續整合流程，縮短版本釋出週期約三成。")
    d.w("")
    d.w("【專業證照】")
    d.w("  PMP 專案管理師、ISO 27001 主導稽核員、Oracle 資料庫管理師")
    d.w("")
    d.w("【自傳】")
    d.w(f"  我是{nm}，成長於重視教育的家庭，自大學起即對資訊系統設計產生濃厚興趣。"
        "畢業後投入公部門資訊委外專案，累積超過十年的系統開發與專案管理經驗。"
        "工作中我重視文件化與溝通，習慣在每個階段整理會議紀錄與問題清單，確保團隊對需求理解一致。"
        "近年專注於資訊安全與個資保護議題，曾協助機關完成個資盤點與風險評鑑。")
    d.w("  在前一份工作中，我帶領六人團隊負責法院案件管理系統的改版，從需求確認、雛型設計到系統上線歷時十四個月。"
        "過程中面對舊系統資料轉換的挑戰，我們設計了分批轉檔與比對驗證機制，最終在不停機的情況下完成移轉。"
        "這段經驗讓我體會到，技術能力之外，與使用者建立信任、清楚說明風險與取捨，才是專案成功的關鍵。")
    d.w("  未來希望能在貴公司持續發揮系統整合與專案管理專長，也期待參與更多雲端化與資安強化的專案，"
        "與團隊一同成長。我的個性沉穩、樂於分享，平日也會撰寫技術筆記，整理工作中遇到的問題與解法。")
    d.w("【語言能力】")
    d.w("  英文：多益 860 分，可閱讀技術文件並以英文進行簡報；日文：日檢 N3。")
    d.w("【專長】")
    d.w("  Java、Python、PostgreSQL、Oracle、Linux 系統管理、Docker、Kubernetes、弱點掃描報告判讀、ISMS 文件撰寫。")
    d.w("【主要專案】")
    d.w("  1. 司法機關案件管理系統改版（專案經理）：導入微服務架構，完成二十餘個子系統介接與資料轉換。")
    d.w("  2. 地方政府公文系統維運（系統分析師）：負責需求分析與規格撰寫，協助機關通過資安稽核。")
    d.w("  3. 醫療院所掛號系統建置（工程師）：負責後端 API 與資料庫設計，支援尖峰每秒千筆查詢。")
    d.w(f"  緊急聯絡人：{d.S(g.name(), 'person')}（配偶）　電話：{d.S(g.mobile(0), 'phone')}")
    d.w(f"  推薦人：{d.S(g.name(), 'person')}，{d.N(g.r.choice(COMPANIES), 'org')}協理。")
    return d


def doc_accounts(g: Gen) -> Doc:
    d = Doc("d04_accounts", "帳號清單表格")
    d.w("系統帳號清查表")
    d.w(f"清查範圍：公文管理系統 {d.N('v5.2.0', 'version')}、差勤系統、檔案伺服器")
    d.w("")
    d.w("|序號|使用者姓名|帳號名稱|所屬單位|權限等級|最後登入|狀態|")
    for i in range(1, 33):
        nm, ac = g.name(), g.acct()
        last = f"115/{g.r.randint(1,9):02d}/{g.r.randint(1,28):02d}"
        d.w(f"|{i}|{d.S(nm, 'person')}|{d.S(ac, 'account')}|{g.r.choice(['秘書室', '資訊室', '人事室', '會計室', '總務科'])}"
            f"|{g.r.choice(['一般', '一般', '管理者', '唯讀'])}|{last}|{g.r.choice(['啟用', '啟用', '停用'])}|")
    d.w("")
    d.w("|系統|服務帳號|用途|")
    for _ in range(4):
        ac = g.acct()
        d.w(f"|{g.r.choice(['AP伺服器', '資料庫', '備份主機', '郵件閘道'])}|{d.S(ac, 'account')}|排程作業 / 系統介接|")
    d.w("")
    d.w("清查結論：停用帳號共 5 筆，建議於下次清查前移除；管理者權限帳號應每季覆核。")
    d.w(f"清查人員：{d.S(g.name(), 'person')}　覆核：{d.S(g.name(), 'person')}")
    return d


def doc_contract(g: Gen) -> Doc:
    d = Doc("d05_contract", "聘僱合約")
    co = g.r.choice(COMPANIES)
    rep, emp = g.name(), g.name()
    d.w("聘僱契約書")
    d.w("")
    d.w(f"立契約書人：{d.N(co, 'org')}（以下簡稱甲方）")
    d.w(f"代表人：{d.S(rep, 'person')}")
    d.w(f"公司地址：{d.N('臺北市內湖區瑞光路999號（虛構）', 'public_address')}")
    d.w(f"乙方姓名：{d.S(emp, 'person')}")
    d.w(f"身分證統一編號：{d.S(g.natid(), 'national_id')}")
    d.w(f"戶籍地址：{d.S(g.address(), 'address')}")
    d.w(f"聯絡電話：{d.S(g.mobile(2), 'phone')}")
    d.w("")
    d.w("雙方同意訂立本契約，條款如下：")
    d.w(f"{d.N('第一條', 'clause')}　聘僱期間：自民國115年8月1日起至116年7月31日止。")
    d.w(f"第二條　工作內容：乙方擔任系統工程師，負責甲方承攬之資訊系統開發及維運工作。")
    sal = g.r.randrange(42000, 85000, 500)
    d.w(f"第三條　薪資：甲方每月給付乙方薪資新臺幣{d.S(f'{sal:,}', 'salary')}元，於次月五日前匯入乙方指定帳戶。")
    d.w(f"　　乙方指定薪資帳戶：{d.N('某某商業銀行', 'org')}{g.r.choice(['南京分行', '板橋分行'])}，帳號{d.S(g.bank(), 'bank_account')}。")
    d.w("第四條　工作時間：每日正常工作時間為八小時，每週不超過四十小時。")
    d.w("第五條　保密義務：乙方因職務知悉或持有甲方及其客戶之業務機密、個人資料，應負保密責任，契約終止後亦同。")
    d.w("第六條　智慧財產權：乙方於聘僱期間因職務所完成之著作，其著作財產權歸屬甲方。")
    d.w("第七條　契約終止：任一方得於三十日前以書面通知他方終止本契約。")
    d.w(f"第八條　本契約如有未盡事宜，依{d.N('勞動基準法', 'law')}及相關法令辦理。")
    d.w("第九條　福利：乙方享有勞工保險、全民健康保險及勞工退休金提繳，並依甲方規定享有年終獎金、員工旅遊及健康檢查等福利。")
    d.w("第十條　請假：乙方請假依勞工請假規則辦理，特別休假依勞動基準法第三十八條規定給予。")
    d.w("第十一條　考核：甲方每半年辦理乙方工作績效考核，考核結果作為調薪及獎金發放之依據。")
    d.w("第十二條　競業禁止：乙方離職後一年內，不得於與甲方有直接競爭關係之同業任職，甲方應依法給予合理補償。")
    d.w("第十三條　個人資料：甲方因人事管理需要蒐集、處理及利用乙方個人資料，應依個人資料保護法規定辦理，並僅於特定目的範圍內使用。")
    d.w("第十四條　爭議處理：雙方因本契約發生爭議時，應先行協商；協商不成時，同意以臺灣臺北地方法院為第一審管轄法院。")
    d.w("第十五條　本契約一式二份，雙方各執一份為憑。")
    d.w("")
    d.w(f"甲方：{co}　代表人：{rep}（簽章）")
    d.w(f"乙方：{emp}（簽章）")
    d.w("中華民國115年7月25日")
    d.w("")
    d.w("附件一：工作說明")
    para(g, d, 6)
    return d


def doc_quarantine(g: Gen) -> Doc:
    d = Doc("d06_quarantine", "居家隔離通知書")
    d.w(f"{d.N('某某市政府衛生局', 'org')}　居家隔離通知書")
    d.w(f"通知書編號：Q-115-{g.r.randint(10000,99999)}")
    d.w("")
    persons = []
    for i in range(4):
        nm = g.name()
        persons.append(nm)
        d.w(f"受隔離者（{i+1}）")
        d.w(f"  姓名：{d.S(nm, 'person')}")
        if i == 3:
            d.w(f"  護照號碼：{d.S(str(g.r.randint(300000000, 399999999)), 'national_id')}")
        else:
            d.w(f"  身分證字號：{d.S(g.natid(), 'national_id')}")
        d.w(f"  出生日期：{d.S(g.birth(), 'birth_date')}")
        d.w(f"  隔離地址：{d.S(g.address(), 'address')}")
        d.w(f"  聯絡電話：{d.S(g.mobile(), 'phone')}")
        d.w("")
    d.w("隔離期間：自115年9月3日起至115年9月10日止。")
    d.w(f"依據：{d.N('傳染病防治法第48條', 'law')}。")
    d.w("注意事項：")
    d.w("一、隔離期間應留在隔離處所，不得外出，亦不得搭乘大眾運輸工具。")
    d.w("二、每日早晚各量測體溫一次並記錄，如有發燒或呼吸道症狀，應主動通報。")
    d.w("三、違反隔離規定者，依法處新臺幣十萬元以上一百萬元以下罰鍰。")
    d.w("  隔離期間如有就醫需求，請先撥打關懷專線，由衛生單位協助安排防疫計程車或救護車，切勿自行前往醫療院所。")
    d.w("  生活物資可由親友協助放置門口，或使用外送服務，取物時應配戴口罩並避免與他人接觸。")
    d.w("  同住家人應盡量分房居住，共用空間保持通風，並以稀釋漂白水定期清潔門把、桌面等經常接觸之表面。")
    d.w("  隔離期滿後仍應進行七日自主健康管理，外出時全程配戴口罩，避免前往人潮擁擠場所。")
    d.w(f"四、本局關懷專線：{d.N('1922', 'public_phone')}；值班聯絡人：{d.S(g.name(), 'person')}，"
        f"電話{d.S(g.landline(ext=True), 'phone')}。")
    d.w(f"五、{persons[0]}君為本戶聯絡窗口，相關通知以其手機簡訊為準。")
    d.w("六、本通知書請妥善保存，隔離期滿後可憑本通知書向雇主申請防疫隔離假，或依規定申請防疫補償。")
    d.w("七、如對本處分不服，得於收受本通知書之次日起三十日內，依訴願法規定提起訴願。")
    return d


def doc_meeting(g: Gen) -> Doc:
    d = Doc("d07_meeting", "會議紀錄")
    names = [g.name() for _ in range(6)]
    for n in names:
        d.S(n, "person")
    a, b, c, e, f, h = names
    d.w(f"{d.N('臺灣新竹地方法院', 'org')}資訊系統維護案　第7次工作會議紀錄")
    d.w(f"時間：115年9月18日 下午2時　地點：{d.N('本院第二會議室', 'location')}")
    d.w("")
    d.w("壹、出席人員：詳簽到單")
    d.w("")
    d.w("貳、報告事項")
    d.w(f"一、上次會議決議追蹤：{a}說明，裁判書查詢系統效能問題已完成索引調整，查詢回應時間由平均8秒降至2秒以內。"
        f"資訊室{b}補充，尖峰時段仍偶有逾時，請廠商持續觀察一週。")
    d.w(f"二、弱點掃描結果：本期共發現中風險弱點12項、低風險20項，{c}表示其中9項已於{d.N('9月10日', 'date')}完成修補，"
        f"其餘3項涉及中介軟體版本升級，預計於{d.N('10月版更', 'date')}一併處理。")
    d.w(f"三、人員異動：原駐點工程師離職，由{e}接任，交接期間由{c}協助支援，已完成帳號權限移轉。")
    d.w("")
    d.w("參、討論事項")
    d.w(f"案由一：檔案伺服器容量不足案。說明：目前使用率達87%，{f}建議採購擴充磁碟陣列，"
        f"預估經費新臺幣{d.N('420,000', 'contract_amount')}元。決議：請資訊室於下次會議提出比價資料。")
    d.w(f"案由二：備份還原演練。{h}說明演練規劃，擬於11月擇一週末進行，演練範圍包含資料庫與公文系統。"
        f"{a}提醒應事先公告停機時間。決議：照案通過。")
    d.w(f"案由三：教育訓練。{b}表示新進同仁對系統操作不熟悉，請廠商安排兩場實體課程，並錄影供日後查閱。決議：由{e}負責聯繫講師。")
    d.w("")
    d.w(f"案由四：個資盤點。{c}說明今年度個資檔案清冊已更新完成，共盤點32項個資檔案，其中高風險4項，"
        f"建議優先導入存取紀錄與遮罩機制。{f}詢問遮罩是否影響查詢效能，{c}回應將先於測試環境評估。決議：同意辦理，請於年底前完成。")
    d.w(f"案由五：系統監控告警。{h}表示目前告警訊息過多，夜間值班人員難以判斷優先順序，"
        f"建議調整門檻並將告警分級。{b}同意，並請{e}彙整近三個月告警統計，下次會議報告。決議：照案辦理。")
    d.w("")
    d.w("肆、臨時動議")
    d.w(f"  {f}提出：下月起駐點人員出勤改採電子簽到，請各單位配合。{a}裁示：先試行一個月再檢討。")
    d.w("  各單位如對本紀錄內容有修正意見，請於三日內提出，逾期視為無意見。")
    d.w(f"伍、散會（下午3時40分）　記錄：{h}")
    d.w("")
    d.w("附件：本期工作進度摘要")
    para(g, d, 7)
    return d


def doc_transfer(g: Gen) -> Doc:
    d = Doc("d08_transfer", "轉帳明細")
    d.w("廠商付款轉帳明細表")
    d.w(f"付款單位：{d.N('北辰系統整合有限公司', 'org')}　付款日期：115/09/30")
    d.w("")
    d.w("序號 | 受款戶名 | 銀行代碼 | 受款帳號 | 金額（元） | 用途")
    for i in range(1, 19):
        nm = g.name()
        amt = g.r.randrange(3000, 90000, 10)
        purpose = g.r.choice(["9月薪資", "9月薪資", "加班費", "差旅費報支", "獎金"])
        cat_amt = d.S(f"{amt:,}", "salary") if purpose in ("9月薪資", "加班費", "獎金") else f"{amt:,}"
        d.w(f"{i} | {d.S(nm, 'person')} | {g.r.choice(['004', '012', '700', '808', '822'])} | "
            f"{d.S(g.bank(), 'bank_account')} | {cat_amt} | {purpose}")
    d.w("")
    d.w(f"轉出帳戶：{d.N('公司營運帳戶（帳號詳財務系統）', 'note')}")
    d.w("合計筆數：18 筆")
    d.w(f"經辦：{d.S(g.name(), 'person')}　主管：{d.S(g.name(), 'person')}")
    d.w("備註：差旅費依實際檢據核銷；薪資已扣除勞健保自付額。")
    para(g, d, 2)
    return d


def doc_ops(g: Gen) -> Doc:
    d = Doc("d09_ops", "系統維運報告")
    d.w("115年9月份系統維運報告")
    d.w(f"版本：{d.N('1.0.4', 'version')}　撰寫：{d.S(g.name(), 'person')}")
    d.w("")
    d.w("一、主機清單")
    d.w("主機名稱 | IP 位址 | 作業系統 | 用途")
    hosts = []
    for hn, os_, use in [("ap01", "Ubuntu 22.04", "應用程式伺服器"), ("ap02", "Ubuntu 22.04", "應用程式伺服器"),
                         ("db01", "RHEL 9.2", "PostgreSQL 主機"), ("bk01", "Windows Server 2022", "備份主機")]:
        ip = g.ip()
        hosts.append((hn, ip))
        d.w(f"{hn} | {d.S(ip, 'ip')} | {d.N(os_, 'version')} | {use}")
    d.w("")
    d.w("二、服務網址")
    u1 = f"http://{hosts[0][1]}:8080/admin/console"
    u2 = "https://erp.chenxi.corp/login"
    u3 = f"https://gitlab.intra.example.local/ops/deploy"
    d.w(f"  管理後台：{d.S(u1, 'url_internal')}")
    d.w(f"  ERP 系統：{d.S(u2, 'url_internal')}")
    d.w(f"  版控平台：{d.S(u3, 'url_internal')}")
    d.w(f"  對外網站：{d.N('https://www.example.gov.tw/', 'public_url')}（公開）")
    d.w("")
    d.w("三、維運紀錄")
    d.w(f"  9/05 db01 磁碟使用率達 82%，已清除 30 天前之交易日誌。")
    d.w(f"  9/12 ap02 套用安全性更新至 {d.N('OpenSSL 3.0.13', 'version')}，重新開機後服務正常。")
    d.w(f"  9/20 防火牆新增規則，允許 {d.S(g.ip(), 'ip')} 存取 db01 之 5432 埠。")
    d.w(f"  9/26 備份作業異常，原因為 bk01 掛載點失效，已重新掛載並補做備份。")
    d.w(f"  9/28 ap01 應用程式記憶體使用率持續偏高，經分析為連線池設定過大，已由 200 調整為 80，觀察兩日後恢復正常。")
    d.w(f"  9/29 監控系統偵測來自 {d.S(g.ip(), 'ip')} 之異常登入嘗試共 143 次，已加入封鎖清單並通報資安窗口。")
    d.w("")
    d.w("四之一、效能統計")
    d.w("  本月 ap01、ap02 平均 CPU 使用率分別為 34% 與 29%，尖峰時段（上午 9 時至 11 時）最高達 71%。")
    d.w("  資料庫平均查詢回應時間 120 毫秒，慢查詢（超過 3 秒）共 18 筆，已提供索引調整建議予開發團隊。")
    d.w("  網路頻寬使用率平均 22%，未達擴充門檻；備份作業平均耗時 2 小時 15 分，較上月縮短 10 分鐘。")
    para(g, d, 4)
    d.w("")
    d.w("四、帳號與連線資訊（限內部使用）")
    a1, p1, a2, p2 = g.acct(), g.password(), g.acct(), g.password()
    d.w(f"  資料庫管理帳號：{d.S(a1, 'account')}　密碼：{d.S(p1, 'credential')}")
    d.w(f"  備份主機登入 user={d.S(a2, 'account')} password={d.S(p2, 'credential')}")
    a3, p3 = g.acct(), g.password()
    d.w(f"  SSH 跳板：ssh {d.S(a3, 'account')}@{d.S(hosts[3][1], 'ip')}（金鑰登入，備援口令 {d.S(p3, 'credential')}）")
    d.w("")
    d.w(f"五、聯絡窗口：值班工程師{d.S(g.name(), 'person')}，手機{d.S(g.mobile(0), 'phone')}，"
        f"信箱{d.S(g.email(), 'email')}。")
    d.w(f"附註：依 {d.N('ISO 27001:2022', 'standard')} 附錄 A 控制措施 {d.N('8.15', 'clause')} 保存日誌。")
    return d


def doc_official(g: Gen) -> Doc:
    d = Doc("d10_official", "公文")
    off = g.name()
    d.w(f"{d.N('臺灣新竹地方法院', 'org')}　函")
    d.w(f"地址：{d.N('300新竹市北區（虛構地址）', 'public_address')}")
    d.w(f"承辦人：{d.S(off, 'person')}")
    d.w(f"電話：{d.S(g.landline(ext=True), 'phone')}")
    d.w(f"電子信箱：{d.S(g.email(), 'email')}")
    d.w("")
    d.w(f"受文者：{d.N('北辰系統整合有限公司', 'org')}")
    d.w(f"發文日期：中華民國115年10月2日")
    d.w(f"發文字號：{d.N('竹院資字第1150004321號', 'doc_no')}")
    d.w("速別：普通件")
    d.w("")
    d.w("主旨：有關貴公司承攬本院「資訊系統維護案」第3季履約報告，請於文到7日內補正，請查照。")
    d.w("說明：")
    d.w(f"一、依貴公司115年9月30日函送之履約報告及{d.N('契約第8條', 'clause')}規定辦理。")
    d.w("二、經審查，報告中弱點修補紀錄未檢附佐證截圖，且人員異動未依規定事先報備，請補正相關資料。")
    d.w(f"三、另貴公司駐點人員{d.S(g.name(), 'person')}之保密切結書已逾期，請重新簽署後併同送院。")
    d.w(f"四、本案聯絡人如有異動，請另以書面通知本院資訊室{off}。")
    d.w("正本：北辰系統整合有限公司")
    d.w("副本：本院資訊室、會計室")
    d.w("")
    d.w("附件：履約報告審查意見表乙份。")
    d.w("")
    d.w("審查意見摘要：")
    d.w("  （一）弱點修補紀錄應載明弱點編號、風險等級、修補日期及驗證方式，並附修補前後掃描結果比對。")
    d.w("  （二）人員異動應於異動前十日以書面報備，並檢附新任人員學經歷、相關證照及保密切結書。")
    d.w("  （三）系統可用率統計請排除機關同意之計畫性停機時間，並註明計算公式。")
    d.w("  （四）教育訓練紀錄請檢附簽到表、課程講義及滿意度調查結果。")
    d.w("")
    d.w("院長　（依分層負責規定授權單位主管決行）")
    para(g, d, 8)
    return d


def doc_incident(g: Gen) -> Doc:
    d = Doc("d11_incident", "資安事件通報單")
    rep, mgr = g.name(), g.name()
    d.w("資通安全事件通報及應變處理單")
    d.w(f"通報單位：{d.N('北辰系統整合有限公司', 'org')}（受託廠商）　事件等級：二級")
    d.w(f"通報人：{d.S(rep, 'person')}　職稱：資安工程師　手機：{d.S(g.mobile(1), 'phone')}")
    d.w(f"通報人信箱：{d.S(g.email(), 'email')}")
    d.w(f"機關資安長：{d.S(mgr, 'person')}　分機：{d.S(g.landline(ext=True), 'phone')}")
    d.w("")
    d.w("一、事件經過")
    ip_a, ip_b = g.ip(), g.ip()
    acct = g.acct()
    d.w(f"  115年9月22日凌晨2時14分，監控系統發現內部主機 {d.S(ip_a, 'ip')} 對外大量連線，"
        f"經初步調查，該主機上之帳號 {d.S(acct, 'account')} 於前一日下午遭暴力破解成功，攻擊來源為內網另一台已受感染之主機 {d.S(ip_b, 'ip')}。")
    d.w("  攻擊者登入後下載挖礦程式並建立排程，造成主機 CPU 使用率長時間維持在 95% 以上。"
        "所幸該主機未存放機敏資料，亦未發現資料外洩跡象。")
    pw = g.password()
    d.w(f"  經查該帳號密碼為弱密碼「{d.S(pw, 'credential')}」，且未啟用多因子認證，違反機關密碼原則。")
    d.w("")
    d.w("二、應變處置")
    d.w("  1. 2時30分隔離受害主機網路，保留記憶體映像與系統日誌供鑑識。")
    d.w(f"  2. 3時10分停用帳號 {acct}，並強制重設同網段所有主機之本機管理者密碼。")
    d.w(f"  3. 6時00分由{d.S(g.name(), 'person')}完成惡意程式清除，並自備份還原系統設定。")
    d.w(f"  4. 9時00分通報機關資安窗口{d.S(g.name(), 'person')}，並依規定於一小時內完成線上通報。")
    d.w("")
    d.w("三、影響範圍")
    d.w("  受影響主機一台，服務中斷約四小時；經比對日誌，攻擊者未橫向移動至資料庫主機。")
    d.w("")
    d.w("四、改善措施")
    d.w("  （一）全面盤點特權帳號，停用閒置帳號，並導入特權帳號管理系統。")
    d.w("  （二）伺服器遠端登入一律改用金鑰並啟用多因子認證，禁止密碼登入。")
    d.w("  （三）調整端點偵測規則，針對異常排程與大量對外連線即時告警。")
    d.w("  （四）於下季教育訓練加入密碼安全與社交工程演練課程。")
    para(g, d, 6)
    d.w(f"填報日期：115年9月23日　審核：{mgr}")
    return d


BUILDERS = [doc_attendance, doc_payroll, doc_resume, doc_accounts, doc_contract,
            doc_quarantine, doc_meeting, doc_transfer, doc_ops, doc_official, doc_incident]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=20261013)
    ap.add_argument("--out", default=str(Path(__file__).parent / "data"))
    args = ap.parse_args()
    g = Gen(args.seed)
    out = Path(args.out)
    (out / "docs").mkdir(parents=True, exist_ok=True)
    gt = []
    for b in BUILDERS:
        d = b(g)
        text = d.text()
        for (t, c) in d.gold:
            assert t in text, (d.id, t)
        (out / "docs" / f"{d.id}.txt").write_text(text, encoding="utf-8")
        gt.append({
            "doc_id": d.id, "type": d.type, "chars": len(text),
            "sensitive": [{"text": t, "category": c} for (t, c) in d.gold],
            "non_sensitive": [{"text": t, "kind": k} for (t, k) in d.ns],
        })
        print(f"{d.id:18s} {d.type:10s} {len(text):5d} 字  敏感 {len(d.gold):3d}  干擾 {len(d.ns)}")
    (out / "ground_truth.json").write_text(json.dumps(gt, ensure_ascii=False, indent=1), encoding="utf-8")
    print("總字數", sum(x["chars"] for x in gt), "敏感片段", sum(len(x["sensitive"]) for x in gt))


if __name__ == "__main__":
    main()
