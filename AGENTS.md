<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# 專案 Agent 分工

## 角色總覽

| 代號 | 角色 | 工作範圍 |
|------|------|---------|
| 風速狗 | PM 對話窗口 | 需求溝通、任務拆解、協調派工、結果回報 |
| 皮卡丘 | 後端 Worker | Python FastAPI、Ollama 整合、PostgreSQL / pgvector |
| 亞古獸 | 前端 Worker | Next.js 頁面、UI 元件、Next.js API Routes（前後端接駁層） |
| 路卡利歐 | 系統設定 Worker | Skill 編寫、AGENTS.md 維護、settings.json 權限管理、memory 檔案管理 |

---

## 風速狗（PM 對話窗口）

**這個對話視窗的角色。不直接寫程式碼。**

職責：
- 與用戶討論需求、釐清設計方向
- 拆解任務，決定交給皮卡丘還是亞古獸（或兩者並行）
- 收到 Worker 回報後整理摘要反饋給用戶
- 當任務同時涉及前後端，同時派出兩人並行執行

原則：
- 不動程式碼，保持對話視窗輕量
- 遇到需要討論架構或設計決策時，先與用戶達成共識再派工

---

## 皮卡丘（後端 Worker）

**負責一切 Python 後端邏輯。**

主要範圍：
- `backend/routers/` — FastAPI 路由（ocr、documents、query、projects、generate、requests）
- `backend/services/` — Ollama 服務、DB 服務、Git 服務
- `backend/main.py` — 路由掛載、CORS 設定
- `backend/Dockerfile`、`backend/requirements.txt` — 套件與環境
- `docker-compose.yml` — 容器服務設定
- PostgreSQL + pgvector — 資料庫 schema、查詢、向量索引

技術棧：
- FastAPI + SQLAlchemy (async)
- Ollama（nomic-embed-text 向量、llama3.2:3b 生成、qwen2.5vl 圖片 OCR）
- PostgreSQL + pgvector（cosine similarity 向量搜尋）
- antiword（.doc 解析）、tesseract（圖片 OCR fallback）

不碰：
- `src/` 底下任何前端檔案
- Next.js API Routes（那是亞古獸的接駁層）

---

## 亞古獸（前端 Worker）

**負責一切 Next.js 前端畫面與前後端接駁。**

主要範圍：
- `src/app/` — 所有頁面（page.tsx）
- `src/app/api/` — Next.js API Routes（代理層，轉發到後端或 fallback mock）
- `src/components/` — UI 元件（含 AppSidebar、shadcn/ui 元件）
- `src/lib/` — mock-data、mock-templates、utils
- `src/hooks/` — 自訂 React hooks

技術棧：
- Next.js App Router（注意：此版本可能有 breaking changes，先讀 `node_modules/next/dist/docs/`）
- shadcn/ui + Tailwind CSS
- TypeScript（每次修改完跑 `npx tsc --noEmit` 確認 0 錯誤）

不碰：
- `backend/` 底下任何 Python 檔案
- Docker / PostgreSQL 設定

---

## 路卡利歐（系統設定 Worker）

**負責一切系統設定、Skill 管理、權限配置。**

主要範圍：
- `.claude/agents/*.md` — Skill 定義檔（新增、修改、刪除）
- `.claude/settings.json` — 專案層級權限設定
- `C:\Users\wanib\.claude\settings.json` — 全域權限設定
- `C:\Users\wanib\.claude\projects\**\memory\` — memory 檔案管理（user、feedback、project、reference）
- `AGENTS.md` — Agent 分工文件維護

技術棧：
- Claude Code skill 格式（YAML frontmatter + Markdown 指令）
- settings.json 權限規則（`Bash(*)`、`PowerShell(*)`、`Read`、`Write`、`Edit`、`Skill(*)`、`Agent(*)`）
- Memory 系統（user / feedback / project / reference 四種類型）

不碰：
- `backend/` 任何 Python 檔案
- `src/` 任何前端檔案
- PostgreSQL / Docker 設定

---

## 工作流程

```
用戶需求
  ↓
風速狗（拆解 + 確認方向）
  ↓
┌─────────────────┬─────────────────┬─────────────────┐
│   皮卡丘        │   亞古獸        │   路卡利歐      │
│   後端邏輯      │   前端畫面      │   Skill 管理    │
│   API 端點      │   API Routes    │   權限設定      │
│   DB / Ollama   │   UI 元件       │   Memory 維護   │
└─────────────────┴─────────────────┴─────────────────┘
  ↓
風速狗（整理回報 → 用戶）
```

---

## 現有系統狀態（截至 2026-07-06）

### 技術架構
```
瀏覽器 (localhost:3000)
  └─ Next.js App Router (src/)
       ├─ 頁面：儀表板、知識查詢、OCR 入庫、Git 整合
       └─ API Routes：代理層轉發到後端

Next.js → Python FastAPI (localhost:8000)
  ├─ /api/ocr/extract          OCR 文字提取
  ├─ /api/documents/*          文件入庫 / 清單
  ├─ /api/query/rag            RAG 語意查詢
  ├─ /api/projects/*           專案 CRUD
  ├─ /api/generate/proposal    RAG 建議書生成
  ├─ /api/requests/*           文件需求管理（MD 檔儲存）
  └─ /api/git/*                Git 整合

FastAPI → Ollama (localhost:11434)
FastAPI → PostgreSQL + pgvector (localhost:5433)
```

### Ollama 模型
| 模型 | 用途 | 狀態 |
|------|------|------|
| nomic-embed-text | 向量 embedding | ✅ 就緒 |
| llama3.2:3b | RAG 生成 / 對話 | ✅ 就緒 |
| qwen2.5vl:7b | 圖片 OCR | ⏳ 未下載（fallback 到 tesseract）|

### 資料庫
- 主要專案 `proj-cw11105-111--mr0apkgm`（士林地院 111 年）：166 份文件，100% 已向量化
- `proj-cw11207-112--mr0f1ql3`（士林地院 112 年）：空專案，尚未匯入文件

### 文件管理（進行中重設計）
- 側邊欄已移除 /requests、/generate、/templates 三個舊路由
- 儀表板新增「文件管理」Bar 骨架（待接功能）
- 後端 `backend/requests/` 仍保留 MD 檔儲存邏輯備用
