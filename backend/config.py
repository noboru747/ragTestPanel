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

    class Config:
        env_file = ".env"


settings = Settings()
