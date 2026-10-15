from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql://rga_user:rga_pass@localhost:5432/rga_km"
    ollama_base_url: str = "http://localhost:11434"
    embed_model: str = "nomic-embed-text"
    chat_model: str = "llama3.2:3b"
    vision_model: str = "qwen2.5vl:7b"
    git_workspace: str = "/workspace/repos"

    # 各功能的供應商："ollama"（預設）或 "openai"（OpenAI 相容 API，例如 ModaOne）
    # LLM_PROVIDER → chat / chat_stream；EMBED_PROVIDER → embed；VISION_PROVIDER → vision_ocr
    llm_provider: str = "ollama"
    openai_base_url: str = ""   # 例：https://modaone-llm-api.dginfra.gov.tw/api/v1（不含 /chat/completions）
    openai_api_key: str = ""
    openai_model: str = ""      # 例：Llama-3.3-70B-Instruct
    openai_timeout: int = 180

    # Embedding
    embed_provider: str = "ollama"            # "ollama" | "openai"
    openai_embed_model: str = "bge-m3"        # 1024 維（DB 欄位需為 vector(1024)）
    # 送進 embedding 前的截斷字數。nomic-embed-text（Ollama）實測 2048 tokens 上限 → 1500；
    # bge-m3 上限 8192 tokens，實測純中文約 0.79 token/字、中英混合約 0.54 → ModaOne 建議 6000
    embed_max_chars: int = 1500

    # 圖片 OCR
    vision_provider: str = "ollama"           # "ollama" | "openai"
    openai_vision_model: str = "gemma-4-31B-it"

    # openai embeddings 一次送幾段（/embeddings input 陣列，ModaOne 實測支援）
    embed_batch_size: int = 16

    # 切段 RAG（CHUNK_SIZE / CHUNK_OVERLAP / MAX_DOC_CHARS 由 services/chunker.py 讀環境變數）
    rag_top_k: int = 8                        # 查詢取前 K 段
    hybrid_vector_weight: float = 0.7
    hybrid_keyword_weight: float = 0.3
    context_max_chars: int = 0                # 0 = 依 provider 預設（openai 12000 / ollama 3000）

    # 用量儀表板（/api/usage/summary）：points 只計 provider=openai 的 tokens
    usage_quota_points: float = 1000
    usage_tokens_per_point: int = 100000
    usage_period_start: str = ""              # ISO 日期，例如 2026-07-01；空白 = 不限
    usage_period_end: str = ""

    @property
    def effective_context_max_chars(self) -> int:
        if self.context_max_chars > 0:
            return self.context_max_chars
        return 12000 if (self.llm_provider or "").strip().lower() == "openai" else 3000

    class Config:
        env_file = ".env"


settings = Settings()
