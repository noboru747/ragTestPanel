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
