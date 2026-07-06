# RGA KM System — 系統架構文件

> 版本：Session 4（2026-07-01）  
> 狀態：本地 Docker 版本完整可用，準備遷移至 GCP

---

## 系統定位

給 PM 用的**本地知識管理 + RAG 查詢系統**。  
核心流程：上傳文件 → OCR 提取文字 → 向量入庫 → 自然語言查詢 → AI 生成文件。

---

## 完整架構

```
┌─────────────────────────────────────────────────────────┐
│  瀏覽器                                                  │
│  http://localhost:3000                                   │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│  Next.js 14 (App Router)                                │
│  src/app/                                               │
│  ├── page.tsx            儀表板（即時統計、新建專案）     │
│  ├── query/page.tsx      知識查詢（RAG 問答）            │
│  ├── ocr/page.tsx        OCR 入庫（批量上傳/資料夾）     │
│  ├── requests/page.tsx   文件需求管理                   │
│  ├── generate/page.tsx   文件生成（觸發 AI 生成）        │
│  ├── projects/[id]/      專案詳情                       │
│  └── api/                Next.js API Routes（代理層）   │
│      ├── query/route.ts        → proxy to backend       │
│      ├── ocr/route.ts          → proxy to backend       │
│      ├── projects/route.ts     → proxy to backend       │
│      ├── generate/proposal/    → proxy to backend       │
│      ├── requests/             → proxy to backend       │
│      └── git/validate/         → proxy to backend       │
└────────────────────────┬────────────────────────────────┘
                         │ HTTP (BACKEND_URL env var)
                         │ 開發：http://localhost:8000
                         │ 生產：http://<gcp-vm-ip>:8000
┌────────────────────────▼────────────────────────────────┐
│  Python FastAPI (port 8000)                             │
│  backend/                                               │
│  ├── main.py                CORS + Router 掛載          │
│  ├── config.py              env 設定（database/ollama） │
│  └── routers/                                           │
│      ├── query.py           /api/query/rag              │
│      ├── documents.py       /api/documents/index+list   │
│      ├── ocr.py             /api/ocr/extract            │
│      ├── projects.py        /api/projects CRUD          │
│      ├── generate.py        /api/generate/proposal      │
│      ├── requests.py        /api/requests CRUD+generate │
│      ├── git_router.py      /api/git/clone+validate     │
│      └── agent.py           /api/agent/run              │
└────────┬───────────────────────────┬────────────────────┘
         │                           │
┌────────▼──────────┐   ┌────────────▼──────────────────┐
│  Ollama           │   │  PostgreSQL 16 + pgvector      │
│  port 11434       │   │  port 5432 (host: 5433)        │
│                   │   │                                │
│  nomic-embed-text │   │  tables:                       │
│  （768 維向量）    │   │  ├── documents                 │
│                   │   │  │   embedding vector(768)     │
│  llama3.2:3b      │   │  ├── projects                  │
│  （對話/生成）     │   │  ├── generated_docs            │
│                   │   │  └── templates                 │
│  qwen2.5vl:7b     │   │                                │
│  （圖片 OCR）     │   │  index: ivfflat cosine         │
│  ⏳ 尚未下載      │   │                                │
└───────────────────┘   └────────────────────────────────┘
```

---

## 各模組說明

### 前端 (Next.js)

| 路徑 | 功能 | 後端狀態 |
|------|------|---------|
| `/` | 儀表板、即時統計、新建專案、Git URL 驗證 | ✅ 已接後端 |
| `/query` | pgvector 語意搜尋 + Ollama RAG 問答 | ✅ 已接後端 |
| `/ocr` | 批量上傳、資料夾拖曳、專案選擇 | ✅ 已接後端 |
| `/requests` | 文件需求 CRUD，建立 MD 需求單 | ✅ 已接後端 |
| `/generate` | 查看需求清單、觸發 AI 生成、顯示結果 | ✅ 已接後端 |
| `/projects/[id]` | 專案文件列表、匯入/查詢 | ✅ 已接後端 |
| `/git` | Git Repo 管理 | ❌ Mock |
| `/templates` | 模板管理 | ❌ Mock |

### 後端服務 (FastAPI)

| 端點 | 功能 |
|------|------|
| `POST /api/ocr/extract` | 提取 PDF/Word/Excel/PPT/圖片文字（tesseract fallback） |
| `POST /api/documents/index` | 文字向量化並存入 pgvector |
| `GET /api/documents/list` | 文件清單 |
| `POST /api/query/rag` | 向量搜尋 + Ollama 生成答案 |
| `GET/POST /api/projects` | 專案 CRUD |
| `POST /api/generate/proposal` | RAG 建議書生成（7 章，timeout 180s） |
| `GET/POST /api/requests` | 需求單 MD 檔案 CRUD |
| `POST /api/requests/{id}/generate` | 觸發 AI 生成並回寫需求 MD |
| `GET /api/git/validate` | Git URL 連線驗證 |

### 資料庫 Schema

```sql
-- pgvector 擴充
CREATE EXTENSION IF NOT EXISTS vector;

-- 知識庫文件（核心）
CREATE TABLE documents (
    id          SERIAL PRIMARY KEY,
    project_id  TEXT NOT NULL DEFAULT 'default',
    filename    TEXT NOT NULL,
    content     TEXT NOT NULL,
    embedding   vector(768),     -- nomic-embed-text 維度
    file_type   TEXT,
    tags        TEXT[],
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (project_id, filename)
);
-- ivfflat 向量索引
CREATE INDEX ON documents USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- 專案
CREATE TABLE projects (
    id TEXT PRIMARY KEY, name TEXT, description TEXT,
    git_url TEXT, status TEXT DEFAULT 'active', tags TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 生成紀錄
CREATE TABLE generated_docs (
    id SERIAL PRIMARY KEY, project_id TEXT, template_id TEXT,
    title TEXT, content TEXT, form_values JSONB, created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 模板
CREATE TABLE templates (
    id TEXT PRIMARY KEY, name TEXT, category TEXT,
    description TEXT, fields JSONB DEFAULT '[]', tags TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Docker Compose 服務

| 服務 | 映像 | Port | 說明 |
|------|------|------|------|
| `postgres` | pgvector/pgvector:pg16 | 5433→5432 | pgvector 資料庫 |
| `ollama` | ollama/ollama:latest | 11434 | 本地 LLM 服務 |
| `ollama-init` | ollama/ollama:latest | — | 初始化拉取模型（一次性） |
| `backend` | 自建（python:3.11-slim） | 8000 | FastAPI 服務 |

啟動指令：
```bash
docker compose up -d postgres ollama backend
```

---

## 環境變數

### Next.js（`.env.local`）
```env
BACKEND_URL=http://localhost:8000        # GCP 版改為 VM 內網 IP
NEXT_PUBLIC_SHOW_OCR=true               # false 可隱藏 OCR 入庫頁
```

### FastAPI（docker-compose.yml 注入）
```env
DATABASE_URL=postgresql://rga_user:rga_pass@postgres:5432/rga_km
OLLAMA_BASE_URL=http://ollama:11434
EMBED_MODEL=nomic-embed-text
CHAT_MODEL=llama3.2:3b
VISION_MODEL=qwen2.5vl:7b
GIT_WORKSPACE=/workspace/repos
```

---

## Ollama 模型狀態

| 模型 | 用途 | 大小 | 狀態 |
|------|------|------|------|
| `nomic-embed-text` | 向量 embedding | ~275MB | ✅ 已下載 |
| `llama3.2:3b` | 對話/RAG/建議書 | ~2GB | ✅ 已下載 |
| `qwen2.5vl:7b` | 圖片 OCR | ~6GB | ⏳ 待下載 |

---

## 資料現狀（截至 2026-07-01）

```
PostgreSQL rga_km：
  documents：167 件，全部有 embedding
    - proj-cw11105-111--mr0apkgm：166 件（士林地院駐點案）
    - proj-002：1 件

  文件類型：PDF 116、Word 40、Excel 4、PPT 4、圖片 3
```

---

## 已知問題

| 問題 | 說明 |
|------|------|
| 建議書生成慢 | llama3.2:3b 約需 60–120 秒 |
| qwen2.5vl 未下載 | 圖片 OCR fallback 到 tesseract，效果可用 |
| Git 頁面 | 前端 mock，尚未接後端 |
| 模板持久化 | 未接 DB |

---

## 待完成（P1）

- [ ] 文件生成結果 Markdown 渲染（react-markdown）
- [ ] Git 頁面接後端（clone + 掃描 repo）
- [ ] 模板持久化（寫入 DB templates table）
- [ ] 需求清單生成中自動輪詢（10 秒刷新）
- [ ] 匯出 Word/PDF
