from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql://rga_user:rga_pass@localhost:5432/rga_km"
    ollama_base_url: str = "http://localhost:11434"
    embed_model: str = "nomic-embed-text"
    chat_model: str = "llama3.2:3b"
    vision_model: str = "qwen2.5vl:7b"
    git_workspace: str = "/workspace/repos"

    class Config:
        env_file = ".env"


settings = Settings()
