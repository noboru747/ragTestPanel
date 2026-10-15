-- 啟用 pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- 文件知識庫
CREATE TABLE IF NOT EXISTS documents (
    id              SERIAL PRIMARY KEY,
    project_id      TEXT NOT NULL DEFAULT 'default',
    filename        TEXT NOT NULL,
    content         TEXT NOT NULL,
    embedding       vector(768),           -- nomic-embed-text 輸出維度
    file_type       TEXT,
    tags            TEXT[],
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    doc_version     TEXT,
    effective_date  DATE,
    superseded_by   INT REFERENCES documents(id),
    content_tsv     TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
    UNIQUE (project_id, filename)
);

CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id);
CREATE INDEX IF NOT EXISTS idx_documents_embedding
    ON documents USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- 專案列表
CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    git_url     TEXT,
    status      TEXT DEFAULT 'active',
    tags        TEXT[],
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 文件生成記錄
CREATE TABLE IF NOT EXISTS generated_docs (
    id          SERIAL PRIMARY KEY,
    project_id  TEXT,
    template_id TEXT NOT NULL,
    title       TEXT NOT NULL,
    content     TEXT NOT NULL,
    form_values JSONB,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 文件模板（後端儲存版）
CREATE TABLE IF NOT EXISTS templates (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    category    TEXT NOT NULL,
    description TEXT,
    fields      JSONB NOT NULL DEFAULT '[]',
    tags        TEXT[],
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 文件模板（前端文件管理用）
CREATE TABLE IF NOT EXISTS document_templates (
  id         VARCHAR PRIMARY KEY,
  name       VARCHAR NOT NULL,
  fields     JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- Migration P2: Hybrid Search (BM25 + pgvector)
-- 新環境已在 CREATE TABLE 包含此欄位；現有環境執行 ALTER 補上
-- ============================================================
ALTER TABLE documents ADD COLUMN IF NOT EXISTS content_tsv TSVECTOR
    GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED;
CREATE INDEX IF NOT EXISTS idx_documents_tsv ON documents USING gin(content_tsv);

-- ============================================================
-- Migration P3: 文件版本 metadata
-- ============================================================
ALTER TABLE documents ADD COLUMN IF NOT EXISTS doc_version     TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS effective_date  DATE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS superseded_by   INT REFERENCES documents(id);

-- ============================================================
-- Migration P4: 敏感資料遮罩對照表（專案範圍、僅存本機）
-- 代號 ↔ 原值；original_value 為明文敏感資料，切勿外送
-- ============================================================
CREATE TABLE IF NOT EXISTS mask_mappings (
    id              SERIAL PRIMARY KEY,
    project_id      TEXT NOT NULL,
    placeholder     TEXT NOT NULL,          -- 例：【IP_1】
    category        TEXT NOT NULL,          -- ip / account / credential ...
    original_value  TEXT NOT NULL,
    filenames       TEXT[] NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (project_id, placeholder),
    UNIQUE (project_id, category, original_value)
);
CREATE INDEX IF NOT EXISTS idx_mask_mappings_project ON mask_mappings(project_id);

-- ============================================================
-- Migration P5: documents.embedding_stale
-- 內容被本機補遮（/api/mask/rescan）改寫後，向量仍是舊內容算的 → 標記待重算
-- /api/documents/index 重新入庫時會清回 false
-- ============================================================
ALTER TABLE documents ADD COLUMN IF NOT EXISTS embedding_stale BOOLEAN NOT NULL DEFAULT FALSE;

-- ============================================================
-- Migration P6: 文件切段（document_chunks）+ 截斷標記 + LLM 用量紀錄（llm_usage）
-- 冪等，可重複執行。適用 rga_km（vector(768)）與 rga_km_modaone（vector(1024)）：
-- document_chunks.embedding 的維度自動取自 documents.embedding（同一個 DB 的 embedding 模型）。
--
-- 套用：bash backend/scripts/create_modaone_db.sh --migrate   （同時套到 rga_km 與 rga_km_modaone）
-- ============================================================
CREATE EXTENSION IF NOT EXISTS vector;

-- 單檔字數上限（MAX_DOC_CHARS）超過時只切段前 N 字：truncated=TRUE，original_chars=壓縮前字數
ALTER TABLE documents ADD COLUMN IF NOT EXISTS truncated      BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS original_chars INT;

DO $$
DECLARE dim INT;
BEGIN
    IF to_regclass('public.document_chunks') IS NULL THEN
        SELECT atttypmod INTO dim FROM pg_attribute
         WHERE attrelid = 'public.documents'::regclass AND attname = 'embedding';
        IF dim IS NULL OR dim <= 0 THEN dim := 768; END IF;
        EXECUTE format($f$
            CREATE TABLE public.document_chunks (
                id            BIGSERIAL PRIMARY KEY,
                document_id   INT  NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
                project_id    TEXT NOT NULL,
                chunk_index   INT  NOT NULL,           -- 0 起算
                content       TEXT NOT NULL,
                char_start    INT  NOT NULL,           -- 在 documents.content（壓縮後）中的位置 [start, end)
                char_end      INT  NOT NULL,
                embedding     public.vector(%s),
                keywords_tsv  TSVECTOR,                -- 中文二元組 + 英數詞（應用層產生，見 services/keywords.py）
                created_at    TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE (document_id, chunk_index)
            )$f$, dim);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_chunks_project   ON document_chunks (project_id);
CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON document_chunks USING hnsw (embedding public.vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_chunks_keywords  ON document_chunks USING gin (keywords_tsv);

-- LLM / embedding / vision 呼叫用量（每次呼叫一筆；只記錄數量，不存 prompt 內容）
CREATE TABLE IF NOT EXISTS llm_usage (
    id                BIGSERIAL PRIMARY KEY,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    provider          TEXT NOT NULL,           -- openai（ModaOne 等平台，計點）| ollama（本機，不計點）
    model             TEXT,
    operation         TEXT NOT NULL,           -- chat | embed | vision
    endpoint          TEXT,
    project_id        TEXT,
    prompt_tokens     INT NOT NULL DEFAULT 0,
    completion_tokens INT NOT NULL DEFAULT 0,
    total_tokens      INT NOT NULL DEFAULT 0,
    latency_ms        INT,
    success           BOOLEAN NOT NULL DEFAULT TRUE,
    error_code        TEXT,
    request_id        TEXT,
    estimated         BOOLEAN NOT NULL DEFAULT FALSE   -- 回應沒有 usage → 以字數估算
);
CREATE INDEX IF NOT EXISTS idx_llm_usage_created ON llm_usage (created_at);
CREATE INDEX IF NOT EXISTS idx_llm_usage_project ON llm_usage (project_id);
