# RGA KM System

> 以 RAG（Retrieval-Augmented Generation）為核心的知識管理系統，支援文件語意查詢、OCR 入庫、文件模板管理與 Git 整合。

## 快速啟動

**前置條件：** Docker Desktop 已安裝並執行

```bash
# 1. Clone 專案
git clone https://github.com/noboru747/ragTestPanel.git
cd ragTestPanel

# 2. 複製環境設定
cp .env.example .env

# 3. 一鍵啟動（首次約需 5-10 分鐘下載 AI 模型）
docker compose up -d

# 4. 開啟瀏覽器
# http://localhost:3000
```

> **首次啟動**：系統會自動下載 nomic-embed-text 和 llama3.2:3b 兩個 Ollama 模型，請耐心等待。

## 系統架構

```
瀏覽器 (localhost:3000)
  └─ Next.js 前端
       └─ FastAPI 後端 (localhost:8000)
            ├─ PostgreSQL + pgvector（向量資料庫）
            └─ Ollama（本地 LLM）
```

## 功能說明

### 專案管理
- 建立並管理多個知識庫專案
- 每個專案獨立儲存與查詢文件

### 知識查詢
- 語意搜尋（RAG）：輸入問題，系統從專案文件找出相關段落並生成回答
- 依專案切換查詢範圍

### OCR 入庫（本地模式）
- 支援 PDF、Word（.doc/.docx）、圖片上傳
- 文字自動提取並向量化入庫
- 啟用方式：在 `.env` 設定 `NEXT_PUBLIC_SHOW_OCR=true`

### 文件模板管理
- 建立可重複使用的文件模板（如：規格建議書、人力經費申請表）
- 每個模板可自訂欄位（文字 / 數字 / 日期 / 多行文字）
- 模板與專案分離，可跨專案使用

### Git 整合
- 連結 Git 儲存庫，將版本控制資料納入知識庫

## 環境變數

| 變數 | 預設值 | 說明 |
|------|--------|------|
| `POSTGRES_DB` | `rga_km` | 資料庫名稱 |
| `POSTGRES_USER` | `rga_user` | 資料庫使用者 |
| `POSTGRES_PASSWORD` | `rga_pass` | 資料庫密碼 |
| `EMBED_MODEL` | `nomic-embed-text` | 向量化模型 |
| `CHAT_MODEL` | `llama3.2:3b` | 對話生成模型 |
| `NEXT_PUBLIC_SHOW_OCR` | `false` | 是否顯示 OCR 入庫功能 |

## 注意事項

- 專案資料與文件索引儲存於 Docker volume，重啟不會遺失
- 刪除 volume（`docker compose down -v`）會清除所有資料
- GPU 加速：編輯 `docker-compose.yml`，取消 ollama service 下的 `deploy` 區塊註解
