#!/usr/bin/env bash
# 建立 ModaOne 專用的獨立資料庫 rga_km_modaone（同一個 rga_postgres 容器內）。
#
# 流程：
#   1. 從現行 rga_km 以 pg_dump --schema-only 取得「實際」schema（init.sql 可能落後）
#   2. vector(768) → vector(1024)（bge-m3），ivfflat 索引 → HNSW（vector_cosine_ops）
#      （ivfflat 在空表上建立 centroid 會導致之後低召回；HNSW 不需訓練資料）
#   3. 輸出到 backend/db/init_modaone.sql（快照，方便檢視 / 版本控管）
#   4. 若 rga_km_modaone 不存在就建立並套用 schema；已存在且有 documents 表則跳過
#
# 用法（專案根目錄，需 rga_postgres 在跑）：
#   bash backend/scripts/create_modaone_db.sh            # 建立（已存在則不動）
#   bash backend/scripts/create_modaone_db.sh --recreate # DROP 後重建（會清空 rga_km_modaone！）
#   bash backend/scripts/create_modaone_db.sh --dump-only # 只重新產生 init_modaone.sql
#   bash backend/scripts/create_modaone_db.sh --migrate   # 只把 db/migrate_*.sql 套到 rga_km 與 rga_km_modaone（冪等）
#
# 向量維度差異：migrate_chunks_usage.sql 的 document_chunks.embedding 維度自動取自同 DB 的
# documents.embedding（rga_km 768 / rga_km_modaone 1024），同一份 migration 兩個 DB 都能套。
#
# 只讀取 rga_km 的 schema，不會修改 rga_km。
set -euo pipefail

CONTAINER="${PG_CONTAINER:-rga_postgres}"
PGUSER_="${POSTGRES_USER:-rga_user}"
SRC_DB="${SRC_DB:-rga_km}"
DST_DB="${DST_DB:-rga_km_modaone}"
EMBED_DIM="${EMBED_DIM:-1024}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_SQL="$SCRIPT_DIR/../db/init_modaone.sql"
MODE="${1:-}"

if [ "$DST_DB" = "$SRC_DB" ]; then
  echo "[ERROR] DST_DB 不可等於 SRC_DB" >&2; exit 1
fi

psql_() { docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U "$PGUSER_" "$@"; }

if [ "$MODE" = "--migrate" ]; then
  for db in "$SRC_DB" "$DST_DB"; do
    for mig in "$SCRIPT_DIR"/../db/migrate_*.sql; do
      [ -f "$mig" ] || continue
      echo "[migrate] $(basename "$mig") → $db"
      psql_ -d "$db" -q < "$mig"
    done
  done
  echo "完成（--migrate）"; exit 0
fi

echo "[1/3] 從 $SRC_DB 匯出 schema 並轉換 → $OUT_SQL"
docker exec "$CONTAINER" pg_dump -U "$PGUSER_" -d "$SRC_DB" --schema-only --no-owner --no-privileges \
  | sed -E \
      -e '/^[\\](un)?restrict /d' \
      -e "s/vector\(768\)/vector(${EMBED_DIM})/g" \
      -e "s/USING ivfflat \(embedding public\.vector_cosine_ops\) WITH \(lists='?[0-9]+'?\)/USING hnsw (embedding public.vector_cosine_ops)/" \
  > "$OUT_SQL.tmp"

grep -q "vector(${EMBED_DIM})" "$OUT_SQL.tmp" || { echo "[ERROR] 找不到 vector(${EMBED_DIM})，轉換失敗" >&2; exit 1; }
if grep -q "USING ivfflat" "$OUT_SQL.tmp"; then echo "[ERROR] 仍有 ivfflat 索引未轉換" >&2; exit 1; fi
{ echo "-- 由 backend/scripts/create_modaone_db.sh 自動產生（來源：$SRC_DB schema），請勿手改"
  echo "-- embedding: vector(${EMBED_DIM})（bge-m3），向量索引：HNSW cosine"
  cat "$OUT_SQL.tmp"; } > "$OUT_SQL"
rm -f "$OUT_SQL.tmp"

[ "$MODE" = "--dump-only" ] && { echo "完成（--dump-only）"; exit 0; }

exists=$(psql_ -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${DST_DB}'")
if [ "$MODE" = "--recreate" ] && [ "$exists" = "1" ]; then
  echo "[2/3] --recreate：DROP DATABASE $DST_DB"
  psql_ -d postgres -c "DROP DATABASE \"${DST_DB}\" WITH (FORCE)"
  exists=""
fi
if [ "$exists" != "1" ]; then
  echo "[2/3] CREATE DATABASE $DST_DB"
  psql_ -d postgres -c "CREATE DATABASE \"${DST_DB}\""
else
  echo "[2/3] $DST_DB 已存在"
fi

has_docs=$(psql_ -d "$DST_DB" -tAc "SELECT to_regclass('public.documents') IS NOT NULL")
if [ "$has_docs" = "t" ]; then
  echo "[3/3] $DST_DB 已有 documents 表，略過套用 schema（要重建請加 --recreate）"
else
  echo "[3/3] 套用 schema 到 $DST_DB"
  psql_ -d "$DST_DB" -q < "$OUT_SQL"
fi

# 冪等 migration：確保既有 DB 也補上後加的表（例如 mask_mappings）
for mig in "$SCRIPT_DIR"/../db/migrate_*.sql; do
  [ -f "$mig" ] || continue
  echo "[migrate] $(basename "$mig") → $DST_DB"
  psql_ -d "$DST_DB" -q < "$mig"
done

psql_ -d "$DST_DB" -c "\d documents" | grep -E "embedding|hnsw" || true
echo "完成。"
