import re
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from services.db_service import get_db
from services.ollama_service import ollama
from routers.documents import _vec

router = APIRouter()


@router.post("/proposal")
async def generate_proposal(payload: dict, db: AsyncSession = Depends(get_db)):
    project_id      = payload.get("project_id")
    tender_name     = payload.get("tender_name", "")
    agency_name     = payload.get("agency_name", "")
    service_type    = payload.get("service_type", "")
    bid_amount      = payload.get("bid_amount", "")
    service_period  = payload.get("service_period", "")
    person_count    = payload.get("person_count", "")
    company_name    = payload.get("company_name", "")
    extra           = payload.get("extra_requirements", "")

    if not project_id:
        raise HTTPException(status_code=422, detail="project_id is required")

    # 1. 向量搜尋：從知識庫抓相關資料
    search_q = f"{tender_name} {service_type} 服務內容 人員規格 合約條件 投標"
    q_vec = await ollama.embed(search_q)
    vec_str = _vec(q_vec)

    where = "WHERE project_id = :project_id"
    params: dict = {"embedding": vec_str, "top_k": 6, "project_id": project_id}

    rows = await db.execute(
        text(f"""
            SELECT filename, content,
                   1 - (embedding <=> CAST(:embedding AS vector)) AS relevance
            FROM documents
            {where}
            ORDER BY embedding <=> CAST(:embedding AS vector)
            LIMIT :top_k
        """),
        params,
    )
    results = rows.fetchall()

    # 2. 組建 RAG context
    context_parts = [
        f"【{r.filename}】\n{r.content[:1200].strip()}"
        for r in results
        if float(r.relevance) > 0.15
    ]
    context = "\n\n---\n\n".join(context_parts) if context_parts else "（知識庫無匹配資料）"

    # 3. Prompt → Ollama 生成
    prompt = f"""你是一個專業的政府採購標案顧問，請根據以下過往案件資料和本次標案資訊，
撰寫一份完整且專業的「投標服務建議書」。
請使用繁體中文，格式為 Markdown。

## 知識庫參考資料（過往類似案件）
{context}

## 本次標案資訊
- 標案名稱：{tender_name}
- 招標機關：{agency_name}
- 服務類型：{service_type}
- 投標金額：{bid_amount} 元
- 服務期間：{service_period}
{f"- 預計派駐人數：{person_count} 人" if person_count else ""}
- 投標廠商名稱：{company_name}
{f"- 特殊需求補充：{extra}" if extra else ""}

請撰寫包含以下七個章節的完整建議書：

# {tender_name} 投標服務建議書

## 一、公司簡介與服務資歷
## 二、服務範圍與工作項目
## 三、人員配置計畫與資格條件
## 四、執行方法與時程規劃
## 五、品質保證措施
## 六、報價明細說明
## 七、廠商服務優勢與結語

請根據知識庫的過往案件資料讓內容更具體，引用相關合約條件與執行經驗。"""

    document = await ollama.chat(prompt)

    sources = [
        {"name": r.filename, "relevance": round(float(r.relevance), 3)}
        for r in results
        if float(r.relevance) > 0.15
    ]

    return {"document": document, "sources": sources}


@router.post("/from-template")
async def generate_from_template(payload: dict, db: AsyncSession = Depends(get_db)):
    template_id = payload.get("template_id", "")
    project_id  = payload.get("project_id", "")
    fields: dict = payload.get("fields", {})

    # 1. 從 DB 查 template
    row = await db.execute(
        text("SELECT name, fields FROM document_templates WHERE id = :template_id"),
        {"template_id": template_id},
    )
    template = row.fetchone()
    if not template:
        raise HTTPException(status_code=404, detail=f"Template not found: {template_id}")

    template_name = template.name

    if not project_id:
        raise HTTPException(status_code=422, detail="project_id is required")

    # ── 判斷是否為建議書模板 ───────────────────────────────────────────────
    is_proposal = "機關名稱" in fields

    # ── 共用：向量搜尋 ────────────────────────────────────────────────────
    if is_proposal:
        court_name     = fields.get("機關名稱", "")
        case_title     = fields.get("標案名稱", "")
        case_code      = fields.get("案號", "")
        company_name   = fields.get("投標公司", "弘捷資訊服務有限公司")
        company_addr   = fields.get("公司地址", "")
        contact_person = fields.get("聯絡人", "")
        contact_phone  = fields.get("聯絡電話", "")
        requirements   = fields.get("需求重點", "")

        query = f"{case_title} {requirements} 工作要項 人力規劃 品質管理"
        top_k = 6
    else:
        # 2. 建立 RAG 查詢 prompt（用欄位值組合 query string）
        query = " ".join(str(v) for v in fields.values() if v)
        top_k = 5

    # 3. 向量搜尋（限制同 project_id）
    q_vec = await ollama.embed(query)
    vec_str = _vec(q_vec)

    where = "WHERE project_id = :project_id"
    params: dict = {"embedding": vec_str, "top_k": top_k, "project_id": project_id}

    rows = await db.execute(
        text(f"""
            SELECT filename, content,
                   1 - (embedding <=> CAST(:embedding AS vector)) AS relevance
            FROM documents
            {where}
            ORDER BY embedding <=> CAST(:embedding AS vector)
            LIMIT :top_k
        """),
        params,
    )
    results = rows.fetchall()

    # 4. 組建 RAG context
    context_parts = [
        f"【{r.filename}】\n{r.content[:1200].strip()}"
        for r in results
        if float(r.relevance) > 0.15
    ]
    context = "\n\n---\n\n".join(context_parts) if context_parts else "（知識庫無匹配資料）"

    sources = [
        {"filename": r.filename, "relevance": round(float(r.relevance), 3)}
        for r in results
        if float(r.relevance) > 0.15
    ]

    # ── 建議書流程 ────────────────────────────────────────────────────────
    if is_proposal:
        prompt = f"""你是政府採購標案顧問。根據以下參考資料和標案資訊，生成建議書內容。
請嚴格使用繁體中文，所有機關名稱、地名、專有名詞保留原文，不得翻譯成英文。

## 參考資料（過往案件）
{context}

## 本次標案
- 機關名稱：{court_name}
- 標案名稱：{case_title}
- 案號：{case_code}
- 需求重點：{requirements}

請依格式輸出以下四個區塊（保留標題行）：

[SCOPE]
履約標的說明（3-5句，說明服務範圍與期間）

[WORK_ITEMS]
工作要項一：標題｜詳細說明（2-3句）
工作要項二：標題｜詳細說明
工作要項三：標題｜詳細說明
工作要項四：標題｜詳細說明

[TEAM_STRUCTURE]
組織與分工說明（2-3句，說明專案經理與工程師配置）

[QUALITY_MANAGEMENT]
品質保證管理說明（3-4句，說明 SLA、PDCA、回應時間等）
"""

        generated = await ollama.chat(prompt, timeout=120)

        # ── 解析生成內容 ──────────────────────────────────────────────────

        def extract_section(text_body: str, tag: str) -> str:
            m = re.search(rf'\[{tag}\]\s*(.*?)(?=\[|$)', text_body, re.DOTALL)
            return m.group(1).strip() if m else ""

        scope_text      = extract_section(generated, "SCOPE")
        work_items_text = extract_section(generated, "WORK_ITEMS")
        team_text       = extract_section(generated, "TEAM_STRUCTURE")
        quality_text    = extract_section(generated, "QUALITY_MANAGEMENT")

        # 解析工作要項
        work_items = []
        for line in work_items_text.splitlines():
            line = line.strip()
            if not line:
                continue
            if "｜" in line:
                parts = line.split("｜", 1)
                title_part = re.sub(r'^工作要項[一二三四五六七八]：?', '', parts[0]).strip()
                work_items.append({
                    "title":   title_part or parts[0].strip(),
                    "content": parts[1].strip(),
                })
            elif "：" in line:
                parts = line.split("：", 1)
                work_items.append({"title": parts[0].strip(), "content": parts[1].strip()})

        if not work_items:
            work_items = [{"title": "設備維護", "content": work_items_text[:200]}]

        # ── 組裝 ProposalData ─────────────────────────────────────────────
        today = date.today().strftime("%Y年%m月%d日")

        proposal_data = {
            "courtName":      court_name,
            "caseTitle":      case_title,
            "caseCode":       case_code,
            "companyName":    company_name,
            "companyAddress": company_addr,
            "contactPerson":  contact_person,
            "contactPhone":   contact_phone,
            "submissionDate": today,
            "summary": [
                {
                    "category":    "專案整體熟悉度及維護服務水準",
                    "description": f"對{court_name}整體軟硬體設備及業務流程之熟悉度",
                    "content":     f"本公司團隊對{court_name}之軟硬體環境有深度了解，提供即時且專業的駐點維護服務。{requirements}",
                },
                {
                    "category":    "專案管理之人力規劃配置",
                    "description": "專案執行人力規劃",
                    "content":     team_text or f"依{case_title}規範，配置專職駐點工程師，另設專案經理統籌協調，確保服務品質。",
                },
                {
                    "category":    "公司履約實績及經營現況",
                    "description": "公司承攬相關政府採購案之實績",
                    "content":     f"{company_name}長期承攬各機關資訊服務採購案，具豐富執行實績，具備充分履約能力。",
                },
                {
                    "category":    "價格合理性",
                    "description": "投標金額之合理性",
                    "content":     "本次投標金額依市場行情及實際人力成本精算，具高度競爭力及合理利潤空間。",
                },
            ],
            "projectOverview": {
                "projectName": f"{court_name}{case_title}",
                "scope": scope_text or f"本案履約標的為提供{court_name}資訊軟體及硬體設備維護駐點服務，服務範圍涵蓋轄下所有資訊設備。",
                "objectives": [
                    f"確保{court_name}資訊設備正常運作，維持各業務系統服務不中斷",
                    "提供即時故障排除服務，縮短設備停機時間",
                    "定期執行設備巡檢與預防性維護，延長設備使用壽命",
                    "建立完整的設備管理文件，提升資訊管理效能",
                ],
                "workItems": work_items if work_items else [
                    {"title": "軟硬體設備維護", "content": f"負責{court_name}全部軟硬體設備之故障排除及維護。"},
                    {"title": "月報文件繳交",   "content": "每月定期提交各式維護工作報告書。"},
                ],
            },
            "hrPlan": {
                "teamStructure": team_text or f"本案配置專案經理1名及駐點工程師數名，分工提供{court_name}現場服務。",
                "totalEngineers": 4,
                "roles": [
                    {
                        "title":          "專案經理",
                        "count":          1,
                        "duties":         "整體專案管理、進度掌控\n客戶窗口溝通協調",
                        "qualifications": "資訊相關科系大學以上\n具5年以上專案管理經驗",
                    },
                    {
                        "title":          "軟體駐點工程師",
                        "count":          2,
                        "duties":         "作業系統安裝與維護\n應用軟體故障排除",
                        "qualifications": "資訊相關科系大學以上\n具3年以上系統維護經驗",
                    },
                    {
                        "title":          "硬體駐點工程師",
                        "count":          2,
                        "duties":         "電腦硬體故障診斷維修\n網路設備維護管理",
                        "qualifications": "電子電機或資訊相關科系\n具3年以上硬體維護經驗",
                    },
                ],
                "qualityManagement": quality_text or "本公司採用PDCA循環管理模式，設立服務品質指標（SLA），要求故障回應時間：緊急障礙2小時內到場、一般障礙4小時內處理完畢。",
            },
            "companyProfile": {
                "established":  "民國96年",
                "capital":      "新台幣2,000萬元",
                "employees":    "35人",
                "introduction": f"{company_name}長期專注於政府機關資訊設備駐點維護服務領域，秉持「專業、誠信、效率」三大核心價值。",
                "experiences": [
                    {"client": court_name, "project": f"前期{case_title}", "period": "前期合約期間", "amount": "依合約"},
                    {"client": "司法院",       "project": "資訊設備維護採購案",     "period": "110.01 - 110.12", "amount": "NT$2,400,000"},
                    {"client": "內政部移民署", "project": "電腦設備維護服務採購案", "period": "111.01 - 111.12", "amount": "NT$1,800,000"},
                ],
            },
            "pricing": {
                "basis": "依照本案規格書要求，依實際派遣人力、社會保險、管理費用及合理利潤計算投標金額。",
                "items": [
                    {"item": "軟體駐點工程師（2名）", "unit": "人月", "quantity": 24, "unitPrice": "NT$58,000", "subtotal": "NT$1,392,000"},
                    {"item": "硬體駐點工程師（2名）", "unit": "人月", "quantity": 24, "unitPrice": "NT$56,000", "subtotal": "NT$1,344,000"},
                    {"item": "備用零件材料費",         "unit": "式",   "quantity":  1, "unitPrice": "NT$400,000", "subtotal": "NT$400,000"},
                    {"item": "管理及交通費用",         "unit": "式",   "quantity":  1, "unitPrice": "NT$320,000", "subtotal": "NT$320,000"},
                ],
                "totalAmount": "NT$3,456,000",
            },
        }

        return {
            "template_name": template_name,
            "fields":        fields,
            "content":       "",          # 空字串，向後相容
            "proposal_data": proposal_data,
            "sources":       sources,
        }

    # ── 非建議書模板：維持原流程 ──────────────────────────────────────────
    # 5. 組建案件資訊段落
    fields_text = "\n".join(f"- {k}：{v}" for k, v in fields.items())

    # 6. Prompt → Ollama 生成（timeout=180）
    prompt = f"""你是一位專業的政府採購顧問，請根據以下資訊生成一份建議書草稿。

案件資訊：
{fields_text}

相關參考資料：
{context}

請輸出以下結構（每個段落用 ## 標題分隔）：
## 前言
## 服務範圍
## 執行方式
## 預期效益
## 結語"""

    content = await ollama.chat(prompt, timeout=180)

    return {
        "template_name": template_name,
        "fields":        fields,
        "content":       content,
        "sources":       sources,
    }
