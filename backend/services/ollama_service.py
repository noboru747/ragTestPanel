import json
import httpx
from typing import AsyncGenerator
from config import settings


class LLMProviderError(RuntimeError):
    """OpenAI 相容 API 回傳錯誤時拋出，訊息內含 HTTP status 與 response body。"""

    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


def _is_openai(provider: str | None) -> bool:
    return (provider or "").strip().lower() == "openai"


def _use_openai() -> bool:
    """文字生成（chat / chat_stream）是否走 OpenAI 相容 API"""
    return _is_openai(settings.llm_provider)


def _image_mime(filename: str) -> str:
    ext = (filename.rsplit(".", 1)[-1] if "." in filename else "").lower()
    return {
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "png": "image/png",
        "webp": "image/webp",
        "gif": "image/gif",
    }.get(ext, "image/png")


OCR_PROMPT = "請完整提取以下圖片中的所有文字內容，保持原始排版結構。"


class OllamaService:
    def __init__(self):
        self.base_url = settings.ollama_base_url

    # ── OpenAI 相容（ModaOne 等）共用 ──────────────────────────────────────
    def _openai_endpoint(self, path: str, model: str, setting_name: str) -> str:
        base = (settings.openai_base_url or "").rstrip("/")
        if not base:
            raise LLMProviderError("使用 openai provider 但未設定 OPENAI_BASE_URL")
        if not model:
            raise LLMProviderError(f"使用 openai provider 但未設定 {setting_name}")
        return f"{base}/{path}"

    def _openai_headers(self) -> dict:
        headers = {"Content-Type": "application/json"}
        if settings.openai_api_key:
            headers["Authorization"] = f"Bearer {settings.openai_api_key}"
        return headers

    @staticmethod
    def _openai_error(res: httpx.Response, body: str) -> LLMProviderError:
        return LLMProviderError(
            f"OpenAI-compatible API error: HTTP {res.status_code} {res.request.url} — {body[:2000]}",
            status_code=res.status_code,
        )

    async def _openai_post(self, path: str, model: str, setting_name: str, payload: dict, timeout: int) -> dict:
        url = self._openai_endpoint(path, model, setting_name)
        async with httpx.AsyncClient(timeout=timeout) as client:
            res = await client.post(url, json=payload, headers=self._openai_headers())
            if res.status_code >= 400:
                raise self._openai_error(res, res.text)
            try:
                return res.json()
            except ValueError:
                raise LLMProviderError(f"OpenAI-compatible API 回應不是 JSON：{res.text[:2000]}")

    @staticmethod
    def _chat_content(data: dict) -> str:
        try:
            return data["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError) as e:
            raise LLMProviderError(f"OpenAI-compatible API 回應格式無法解析（{e}）：{json.dumps(data, ensure_ascii=False)[:2000]}")

    async def _openai_chat(self, prompt: str, timeout: int) -> str:
        payload = {
            "model": settings.openai_model,
            "messages": [{"role": "user", "content": prompt}],
            "stream": False,
            # 注意：非串流不可帶 stream_options（ModaOne 會報錯）
        }
        data = await self._openai_post(
            "chat/completions", settings.openai_model, "OPENAI_MODEL", payload,
            max(timeout, settings.openai_timeout),
        )
        return self._chat_content(data)

    async def _openai_chat_stream(self, prompt: str) -> AsyncGenerator[str, None]:
        url = self._openai_endpoint("chat/completions", settings.openai_model, "OPENAI_MODEL")
        payload = {
            "model": settings.openai_model,
            "messages": [{"role": "user", "content": prompt}],
            "stream": True,
        }
        async with httpx.AsyncClient(timeout=settings.openai_timeout) as client:
            async with client.stream("POST", url, json=payload, headers=self._openai_headers()) as res:
                if res.status_code >= 400:
                    body = (await res.aread()).decode("utf-8", errors="replace")
                    raise self._openai_error(res, body)
                async for line in res.aiter_lines():
                    line = line.strip()
                    if not line or not line.startswith("data:"):
                        continue
                    data_str = line[5:].strip()
                    if data_str == "[DONE]":
                        break
                    try:
                        data = json.loads(data_str)
                    except ValueError:
                        continue
                    if "error" in data:
                        raise LLMProviderError(f"OpenAI-compatible stream error: {data_str[:2000]}")
                    choices = data.get("choices") or []
                    if not choices:
                        continue
                    token = (choices[0].get("delta") or {}).get("content")
                    if token:
                        yield token

    # ── 公開介面（routers 使用）────────────────────────────────────────
    async def chat(self, prompt: str, model: str | None = None, timeout: int = 120) -> str:
        if _use_openai():
            # openai 模式忽略呼叫方傳入的 Ollama model 名稱，一律用 settings.openai_model
            return await self._openai_chat(prompt, timeout)
        model = model or settings.chat_model
        async with httpx.AsyncClient(timeout=timeout) as client:
            res = await client.post(
                f"{self.base_url}/api/generate",
                json={"model": model, "prompt": prompt, "stream": False},
            )
            res.raise_for_status()
            return res.json()["response"]

    async def chat_stream(self, prompt: str, model: str | None = None) -> AsyncGenerator[str, None]:
        if _use_openai():
            async for token in self._openai_chat_stream(prompt):
                yield token
            return
        model = model or settings.chat_model
        async with httpx.AsyncClient(timeout=120) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/api/generate",
                json={"model": model, "prompt": prompt, "stream": True},
            ) as res:
                async for line in res.aiter_lines():
                    if line:
                        data = json.loads(line)
                        if token := data.get("response"):
                            yield token
                        if data.get("done"):
                            break

    async def embed(self, text: str) -> list[float]:
        # 安全網：無論呼叫方是否截斷，都不超過 embed_max_chars
        text = text[: settings.embed_max_chars]
        if _is_openai(settings.embed_provider):
            data = await self._openai_post(
                "embeddings", settings.openai_embed_model, "OPENAI_EMBED_MODEL",
                {"model": settings.openai_embed_model, "input": text},
                settings.openai_timeout,
            )
            try:
                return data["data"][0]["embedding"]
            except (KeyError, IndexError, TypeError) as e:
                raise LLMProviderError(f"embedding 回應格式無法解析（{e}）：{json.dumps(data)[:500]}")
        async with httpx.AsyncClient(timeout=120) as client:
            res = await client.post(
                f"{self.base_url}/api/embeddings",
                json={"model": settings.embed_model, "prompt": text},
            )
            res.raise_for_status()
            return res.json()["embedding"]

    async def vision_ocr(self, image_base64: str, filename: str = "") -> str:
        prompt = f"{OCR_PROMPT}文件名稱：{filename}"
        if _is_openai(settings.vision_provider):
            mime = _image_mime(filename)
            payload = {
                "model": settings.openai_vision_model,
                "messages": [{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt + "\n只輸出圖片中的文字，不要加任何說明。"},
                        {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{image_base64}"}},
                    ],
                }],
                "stream": False,
                "temperature": 0,
            }
            data = await self._openai_post(
                "chat/completions", settings.openai_vision_model, "OPENAI_VISION_MODEL",
                payload, settings.openai_timeout,
            )
            return self._chat_content(data)
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
        if _use_openai():
            return [settings.openai_model] if settings.openai_model else []
        async with httpx.AsyncClient(timeout=30) as client:
            res = await client.get(f"{self.base_url}/api/tags")
            res.raise_for_status()
            return [m["name"] for m in res.json().get("models", [])]


ollama = OllamaService()
