# RGA KM System — 工作進度總覽

> 最後更新：2026-07-01（Session 4）
> 用途：接力開發時快速進入狀態

---

## 系統定位

給 PM 用的本地知識管理 + RAG 系統。  
PM 把專案文件（PDF/Word/Excel/PPT/圖片）批量上傳 → OCR 入庫 → 語意查詢。  
同時可依知識庫資料自動生成建議書、會議紀錄、規格書等正式文件。

**關鍵限制：**
- 全部在 PM 本地執行（git clone → docker compose up）
- 不用 cloud API token，全用 Ollama 本地模型
- Vercel 有展示版，OCR 介面用環境變數遮蔽（`NEXT_PUBLIC_SHOW_OCR`）

---

## 啟動步驟（每次開工前確認）

```powershell
# 1. 啟動 Docker 服務
cd c:\myLab\rga-km-system-free
docker compose up -d postgres ollama backend

# 2. 確認全部起來
docker ps --filter "name=rga"
# 應看到：rga_backend (8000), rga_postgres (5433), rga_ollama (11434)

# 3. 健康檢查
curl http://localhost:8000/health   # {"status": "ok"}

# 4. 前端
npm run dev    # → http://localhost:3000
```

> **注意**：PostgreSQL host port 是 **5433**（5432 被另一個 gis-test 專案占用）

---

## Ollama 模型現狀

| 模型 | 用途 | 狀態 |
|------|------|------|
| `nomic-embed-text` | 向量 embedding（文件入庫 + 查詢） | ✅ 已下載 |
| `llama3.2:3b` | 對話 / RAG 生成 / 建議書生成 | ✅ 已下載 |
| `qwen2.5vl:7b` | 圖片 OCR（視覺模型） | ⏳ 尚未下載（6GB） |

圖片 OCR 目前 fallback 到 **tesseract**（中文繁/簡 + 英文），效果夠用。  
qwen2.5vl 下載後視覺 OCR 自動升級，tesseract 只是備案：
```powershell
docker exec rga_ollama ollama pull qwen2.5vl:7b
```

---

## 架構圖

```
瀏覽器 (localhost:3000)
  └─ Next.js App Router
       ├─ src/app/          ← 頁面
       ├─ src/app/api/      ← Next.js API Routes（代理層，fallback mock）
       └─ src/lib/          ← mock-data / mock-templates

Next.js API Routes → Python FastAPI (localhost:8000)
  ├─ /api/ocr/extract             ← 文件提取文字
  ├─ /api/documents/index         ← 文字 → 向量入庫
  ├─ /api/documents/list          ← 文件清單
  ├─ /api/query/rag               ← 語意搜尋 + Ollama RAG 生成
  ├─ /api/projects/*              ← 專案 CRUD
  ├─ /api/generate/proposal       ← RAG 建議書生成
  ├─ /api/requests                ← 文件需求清單 + 建立 ★ Session 4 新增
  ├─ /api/requests/{id}           ← 取得 / 刪除單筆需求 ★ 新增
  ├─ /api/requests/{id}/generate  ← 觸發 AI 生成並回寫 MD ★ 新增
  ├─ /api/git/validate            ← Git URL 驗證
  └─ /api/agent/run               ← PM 指令 Agent

Python FastAPI → Ollama (localhost:11434)
Python FastAPI → PostgreSQL + pgvector (localhost:5433)
```

---

## 檔案結構（完整）

### 前端 (Next.js)

```
src/
├── app/
│   ├── page.tsx                        ← 儀表板（即時 DB 統計 + 新建專案 + Git 驗證）
│   ├── generate/page.tsx               ← 文件生成（RAG 建議書 + 靜態模板）★ 本次更新
│   ├── templates/page.tsx              ← 模板管理清單
│   ├── query/page.tsx                  ← 知識查詢（RAG 問答，專案篩選）✅ 已接後端
│   ├── ocr/page.tsx                    ← OCR 入庫（批量上傳、資料夾支援）✅ 已接後端
│   ├── git/page.tsx                    ← Git 整合（mock）
│   ├── projects/[id]/page.tsx          ← 專案詳情（文件列表 + 匯入/查詢按鈕）
│   └── api/
│       ├── ocr/route.ts                ✅ proxy → backend
│       ├── query/route.ts              ✅ proxy → backend RAG
│       ├── generate/route.ts           ← 靜態模板生成（mock）
│       ├── generate/proposal/route.ts  ✅ proxy → backend RAG 建議書 ★ 新增
│       ├── git/validate/route.ts       ✅ proxy → backend git validate
│       ├── projects/route.ts           ✅ proxy → backend（fallback mock）
│       └── projects/[id]/route.ts      ✅ proxy → backend
├── components/
│   └── ui/                             ← shadcn/ui 元件
└── lib/
    ├── mock-data.ts                    ← mockProjects, mockDocuments 等
    └── mock-templates.ts               ← 文件模板定義（含 ragEnabled 旗標）★ 已擴充
```

### 後端 (Python FastAPI)

```
backend/
├── main.py                  ← FastAPI app + CORS + router 掛載
├── config.py                ← 環境變數設定
├── Dockerfile               ← python:3.11-slim + git + antiword + tesseract ★ 本次更新
├── requirements.txt         ← 加入 pytesseract ★ 本次更新
├── routers/
│   ├── ocr.py               ← /api/ocr/extract（PDF/Word/Excel/PPT/圖片）★ 更新
│   ├── documents.py         ← /api/documents/index + /list + /search
│   ├── query.py             ← /api/query/rag（向量搜尋 + Ollama 生成）
│   ├── projects.py          ← /api/projects CRUD（list/create/update/delete）
│   ├── generate.py          ← /api/generate/proposal（RAG 建議書）★ 本次新增
│   ├── agent.py             ← /api/agent/run + /parse-md
│   └── git_router.py        ← /api/git/clone + /context + /validate
└── services/
    ├── ollama_service.py    ← chat / embed / vision_ocr / list_models
    ├── db_service.py        ← SQLAlchemy async session
    ├── md_parser.py         ← 解析 MD 指令
    └── git_service.py       ← gitpython 封裝
```

---

## 各功能實際狀態

| 頁面 | 路徑 | 後端 | 說明 |
|------|------|------|------|
| 儀表板 | `/` | ✅ 已接 | 即時 DB 統計、新建專案含 Git URL 驗證 |
| **文件需求管理** | `/requests` | ✅ 已接 | 建立需求表單，儲存為 MD 檔案 ★ Session 4 新增 |
| **文件生成紀錄** | `/generate` | ✅ 已接 | 查看需求清單、觸發 AI 生成、查看結果 ★ Session 4 改版 |
| 模板管理 | `/templates` | ❌ Mock | 純前端狀態，未持久化 |
| 知識查詢 | `/query` | ✅ 已接 | pgvector 語意搜尋 + Ollama RAG |
| OCR 入庫 | `/ocr` | ✅ 已接 | 批量上傳、資料夾拖曳、專案選擇 |
| 專案詳情 | `/projects/[id]` | ✅ 已接 | 文件列表、匯入/查詢導航按鈕 |
| Git 整合 | `/git` | ❌ Mock | 待接 |

---

## Session 4 完成項目（2026-07-01）

### 文件需求管理系統（全新）
- ✅ **`backend/routers/requests.py`** — MD 檔案 CRUD（list/create/get/delete）+ `POST /{id}/generate`（RAG 生成回寫）
- ✅ **`backend/requests/`** — 需求 MD 檔案儲存目錄（自動建立，volume 掛載 `./backend:/app`）
- ✅ **`backend/main.py`** — 掛載 `/api/requests` 路由
- ✅ **Next.js API routes** — `/api/requests`、`/api/requests/[id]`、`/api/requests/[id]/generate`
- ✅ **`/requests` 頁面**（全新）— 建立文件需求對話框（模板選擇 + 欄位填寫），清單、預覽 MD、刪除
- ✅ **`/generate` 頁面**（完全改版）— 兩欄式：左側需求清單（狀態 Badge），右側詳情 + 生成按鈕 + 結果展示
- ✅ **`AppSidebar.tsx`** — 新增「文件需求管理」`/requests` 導航項目

### MD 檔案格式（backend/requests/req-{id}.md）
```
---
id: req-20260701072740-ebe73d
title: 文件標題
doc_type: 採購
template_id: tmpl-rag-001
project_id: proj-xxx
project_name: 專案名稱
status: pending | generating | completed | error
created_at: 2026-07-01T07:27:40
completed_at: （完成後填入）
form_data: {"欄位": "值", ...}
---

# 文件需求：標題

## 📋 需求內容
| 欄位 | 內容 |
...

## 🔖 生成設定
...

---

## ✅ 生成結果
（AI 生成後回寫此區段）
```

---

## 本次（Session 3）完成項目

### OCR 相關
- ✅ **OCR 頁面專案選擇器** — 從 mock 改成從 `/api/projects` 動態載入真實專案
- ✅ **URL param 預選專案** — `?projectId=xxx` 自動選中對應專案（timing 正確：先設值再載選項）
- ✅ **資料夾上傳支援** — 拖曳整個資料夾或點「選擇資料夾」按鈕，遞迴讀取所有符合副檔名的檔案
- ✅ **`.doc` 舊版 Word 支援** — Dockerfile 加入 `antiword`，後端處理 `application/msword`
- ✅ **圖片 OCR fallback** — qwen2.5vl 失敗時自動改用 `tesseract`（中繁+中簡+英），不再回 500
- ✅ **MIME 類型 fallback** — 瀏覽器送 `application/octet-stream` 時改用副檔名判斷

### 建議書生成（RAG-powered）
- ✅ **新增 `backend/routers/generate.py`** — `POST /api/generate/proposal`，RAG 抓相關文件 → Ollama 生成 7 章建議書
- ✅ **新增 `src/app/api/generate/proposal/route.ts`** — Next.js proxy，timeout 180s
- ✅ **擴充 `mock-templates.ts`** — 加入 `ragEnabled` / `apiPath` 旗標、新增 `project_select` 欄位型別
- ✅ **更新 generate page** — 專案下拉動態載入、RAG 模板走真實 API、靜態模板維持原邏輯、結果顯示引用來源、匯出 .md

### 設定與基礎設施
- ✅ **`.claude/settings.json` 更新** — 加入 `Bash(cd *)`, `Bash(docker *)`, `Bash(git *)`, `PowerShell(cd *)`, `PowerShell(docker *)`, `PowerShell(git *)` 免確認

---

## 資料庫現狀（CW11105 專案）

```
資料庫：rga_km（PostgreSQL + pgvector）
documents 表：167 件，全部有 embedding（向量已建立）
  - proj-cw11105-111--mr0apkgm：166 件（士林地院駐點案文件）
  - proj-002：1 件

文件類型分布：
  PDF：116 件
  Word (.docx)：40 件
  Excel：4 件
  PPT：4 件
  圖片：3 件
```

---

## 下一步工作清單

### P1 — 功能補完
- [ ] **文件生成結果 Markdown 渲染**：`/generate` 結果區用 `react-markdown` 取代 `<pre>` 顯示
- [ ] **Git 頁面接後端**：`src/app/api/git/route.ts` 呼叫 `POST /api/git/clone` + 掃描 repo
- [ ] **模板持久化**：templates 頁面增刪改寫入 `templates` DB table
- [ ] **需求清單自動輪詢**：`/generate` 頁生成中時每 10 秒重新整理狀態

### P2 — 建議書功能強化
- [ ] **匯出 Word/PDF**：除了 `.md` 外支援 docx 匯出
- [ ] **需求範本預填**：建立需求時從先前已完成的案件拉入預設值

### P3 — Vercel 展示版
- [ ] `NEXT_PUBLIC_SHOW_OCR=false` 環境變數確認
- [ ] 所有後端 proxy 在無後端時 fallback mock

---

## 已知問題 / 注意事項

| 問題 | 說明 |
|------|------|
| 建議書生成慢 | llama3.2:3b 速度慢，生成 7 章約需 60–120 秒，前端有 spinner 提示 |
| qwen2.5vl 未下載 | 圖片改 tesseract fallback，效果可用但不如視覺模型 |
| PowerShell 中文亂碼 | API 資料正常，是 terminal 顯示問題，不影響功能 |
| `.claude/settings.json` 被 hook 汙染 | 已清除，settings 現在乾淨 |

---

## 已解決的坑

| 問題 | 解法 |
|------|------|
| PostgreSQL port 衝突 | compose 用 `5433:5432` |
| asyncpg 不支援 `::vector` | 改 `CAST(:param AS vector)` |
| useSearchParams 需要 Suspense | OcrPage 外包一層 `<Suspense>` wrapper |
| `.doc` 舊版 Word 無法解析 | Dockerfile 加 `antiword`，後端 subprocess 呼叫 |
| 圖片 OCR 500 | vision_ocr 加 try-except，fallback tesseract |
| MIME 類型不準 | 加 `_guess_type_by_ext()` 依副檔名判斷 |
| 向量搜尋無結果 | 確認為後端剛重啟未就緒，非程式碼問題 |
| settings.json 被 hook 記入執行過的指令 | 手動刪除多餘 PowerShell 規則 |

---

## 快速測試指令

```powershell
# 確認文件數量與 embedding 狀態
docker exec rga_postgres psql -U rga_user -d rga_km -c "SELECT COUNT(*) total, COUNT(embedding) has_vec FROM documents;"

# 測試 RAG 查詢
$body = @{ question = "合約金額"; project_id = "proj-cw11105-111--mr0apkgm"; top_k = 3 } | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:8000/api/query/rag" -Method Post -Body $body -ContentType "application/json"

# 測試建議書生成
$body = @{ project_id = "proj-cw11105-111--mr0apkgm"; tender_name = "114年度資訊駐點案"; agency_name = "臺灣士林地方法院"; service_type = "駐點人員服務"; bid_amount = "250000"; service_period = "114年1月至12月"; company_name = "弘捷資訊服務有限公司" } | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:8000/api/generate/proposal" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 180

# 查 Ollama 模型
docker exec rga_ollama ollama list
```

---

## 環境變數

```env
# .env.local
NEXT_PUBLIC_SHOW_OCR=true
BACKEND_URL=http://localhost:8000

POSTGRES_DB=rga_km
POSTGRES_USER=rga_user
POSTGRES_PASSWORD=rga_pass
```

後端環境變數由 docker-compose.yml 注入。
