import httpx
from typing import AsyncGenerator
from config import settings


class OllamaService:
    def __init__(self):
        self.base_url = settings.ollama_base_url

    async def chat(self, prompt: str, model: str | None = None, timeout: int = 120) -> str:
        model = model or settings.chat_model
        async with httpx.AsyncClient(timeout=timeout) as client:
            res = await client.post(
                f"{self.base_url}/api/generate",
                json={"model": model, "prompt": prompt, "stream": False},
            )
            res.raise_for_status()
            return res.json()["response"]

    async def chat_stream(self, prompt: str, model: str | None = None) -> AsyncGenerator[str, None]:
        model = model or settings.chat_model
        async with httpx.AsyncClient(timeout=120) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/api/generate",
                json={"model": model, "prompt": prompt, "stream": True},
            ) as res:
                async for line in res.aiter_lines():
                    if line:
                        import json
                        data = json.loads(line)
                        if token := data.get("response"):
                            yield token
                        if data.get("done"):
                            break

    async def embed(self, text: str) -> list[float]:
        async with httpx.AsyncClient(timeout=60) as client:
            res = await client.post(
                f"{self.base_url}/api/embeddings",
                json={"model": settings.embed_model, "prompt": text},
            )
            res.raise_for_status()
            return res.json()["embedding"]

    async def vision_ocr(self, image_base64: str, filename: str = "") -> str:
        prompt = (
            f"請完整提取以下圖片中的所有文字內容，保持原始排版結構。"
            f"文件名稱：{filename}"
        )
        async with httpx.AsyncClient(timeout=180) as client:
            res = await client.post(
                f"{self.base_url}/api/generate",
                json={
                    "model": settings.vision_model,
                    "prompt": prompt,
                    "images": [image_base64],
                    "stream": False,
                },
            )
            res.raise_for_status()
            return res.json()["response"]

    async def list_models(self) -> list[str]:
        async with httpx.AsyncClient(timeout=30) as client:
            res = await client.get(f"{self.base_url}/api/tags")
            res.raise_for_status()
            return [m["name"] for m in res.json().get("models", [])]


ollama = OllamaService()
