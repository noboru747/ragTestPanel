---
name: doc-gen-prep
description: 生成文件 React 模板的事前準備 — 從 API 讀取模板欄位與專案文件清單，輸出結構化 briefing，作為派工給亞古獸之前的上下文整備
tools:
  - PowerShell
  - Bash
  - Read
---

# 文件生成事前準備

此 skill 在「要生成文件 React 模板」前執行。目標是從資料庫收集齊所有必要資料，輸出一份 briefing 讓後續派工有完整上下文。

## 執行流程

### Step 1：查詢所有文件模板

```powershell
docker exec rga_postgres psql -U rga_user -d rga_km -c "SELECT id, name, fields FROM document_templates ORDER BY created_at;"
```

### Step 2：查詢所有專案

```powershell
Invoke-RestMethod -Uri "http://localhost:8000/api/projects" -Method Get
```

### Step 3：確認目標

若呼叫 skill 時有傳入引數（template name 或 project name），直接使用。
否則，列出 Step 1 和 Step 2 的結果，詢問用戶：
- 要使用哪個文件模板？
- 要綁定哪個專案的知識庫？

### Step 4：查詢選定專案的文件清單

```powershell
Invoke-RestMethod -Uri "http://localhost:8000/api/documents/list?project_id={選定的 project_id}&limit=50" -Method Get
```

### Step 5：輸出 Briefing

輸出以下格式的結構化資訊，供後續派工：

```
## Doc-Gen Briefing

### 文件模板
- 名稱：{template.name}
- ID：{template.id}
- 欄位定義：
  {每個欄位} → label（type）

### 綁定專案
- 名稱：{project.name}
- ID：{project.id}
- 文件數：{N} 份
- 文件清單（前 30）：
  {filename 列表}

### 建議元件名稱
根據模板名稱推導（例：規格建議書 → SpecProposalForm）

### 亞古獸任務摘要
根據以上欄位，在 /templates/{template.id} 頁面下方新增「文件預覽 / 填寫表單」區塊：
- 每個欄位對應一個 input（type 對應 number/date/text/textarea）
- 可填入資料後「生成草稿」，呼叫後端 RAG API 以欄位值 + 專案文件作為 context 生成建議內容
```

## 注意事項

- 中文顯示問題：若 PowerShell 輸出亂碼，改用 `docker exec rga_postgres psql ...` 直接查 DB
- 若後端未啟動（`http://localhost:8000` 無回應），提示用戶先執行 `docker compose -p rga-km up -d`
- 輸出 briefing 後，詢問用戶是否要立即派工給亞古獸
