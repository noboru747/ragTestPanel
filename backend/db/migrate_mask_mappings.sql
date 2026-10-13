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
