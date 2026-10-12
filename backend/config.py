from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql://rga_user:rga_pass@localhost:5432/rga_km"
    ollama_base_url: str = "http://localhost:11434"
    embed_model: str = "nomic-embed-text"
    chat_model: str = "llama3.2:3b"
    vision_model: str = "qwen2.5vl:7b"
    git_workspace: str = "/workspace/repos"

    # LLM 文字生成供應商："ollama"（預設）或 "openai"（OpenAI Chat Completions 相容，例如 ModaOne ModelSpace）
    # embed / vision_ocr 目前仍固定走 Ollama
    llm_provider: str = "ollama"
    openai_base_url: str = ""   # 例：https://modaone-llm-api.dginfra.gov.tw/api/v1（不含 /chat/completions）
    openai_api_key: str = ""
    openai_model: str = ""      # 例：Llama-3.3-70B-Instruct
    openai_timeout: int = 180

    class Config:
        env_file = ".env"


settings = Settings()
