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
