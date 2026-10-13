-- ============================================================
-- Migration P5: documents.embedding_stale
-- 內容被本機補遮（/api/mask/rescan）改寫後，向量仍是舊內容算的 → 標記待重算
-- /api/documents/index 重新入庫時會清回 false
-- ============================================================
ALTER TABLE documents ADD COLUMN IF NOT EXISTS embedding_stale BOOLEAN NOT NULL DEFAULT FALSE;
