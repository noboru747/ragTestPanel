import json
import time
import httpx
from typing import AsyncGenerator
from config import settings
from services.usage import record_usage, usage_from_ollama, usage_from_openai


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


def _error_code(exc: BaseException) -> str:
    sc = getattr(exc, "status_code", None)
    if isinstance(sc, int):
        return f"http_{sc}"
    if isinstance(exc, httpx.HTTPStatusError):
        return f"http_{exc.response.status_code}"
    if isinstance(exc, httpx.TimeoutException):
        return "timeout"
    return type(exc).__name__


def _ms(t0: float) -> float:
    return (time.perf_counter() - t0) * 1000


OCR_PROMPT = "請完整提取以下圖片中的所有文字內容，保持原始排版結構。"


class OllamaService:
    """
    所有呼叫都會寫一筆 llm_usage（services.usage，背景寫入、失敗不影響主流程）：
      openai：回應 usage（prompt/completion/total_tokens）；缺少時以字數估算並標 estimated
      ollama：prompt_eval_count / eval_count；缺少時估算
    """

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

    async def _openai_chat(self, prompt: str, timeout: int) -> tuple[str, dict]:
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
        return self._chat_content(data), data

    async def _openai_chat_stream(self, prompt: str, usage_box: dict) -> AsyncGenerator[str, None]:
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
                    if data.get("usage"):
                        usage_box["data"] = data          # 最後事件可能帶 usage
                    if data.get("id"):
                        usage_box["id"] = data["id"]
                    choices = data.get("choices") or []
                    if not choices:
                        continue
                    token = (choices[0].get("delta") or {}).get("content")
                    if token:
                        yield token

    # ── 公開介面（routers 使用）────────────────────────────────────────
    async def chat(self, prompt: str, model: str | None = None, timeout: int = 120) -> str:
        t0 = time.perf_counter()
        if _use_openai():
            # openai 模式忽略呼叫方傳入的 Ollama model 名稱，一律用 settings.openai_model
            meta = dict(provider="openai", model=settings.openai_model, operation="chat", endpoint="chat/completions")
            try:
                content, data = await self._openai_chat(prompt, timeout)
            except Exception as exc:
                record_usage(**meta, usage=None, prompt_text=prompt, latency_ms=_ms(t0), success=False,
                             error_code=_error_code(exc))
                raise
            record_usage(**meta, usage=usage_from_openai(data), prompt_text=prompt, completion_text=content,
                         latency_ms=_ms(t0), request_id=data.get("id"))
            return content
        model = model or settings.chat_model
        meta = dict(provider="ollama", model=model, operation="chat", endpoint="/api/generate")
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                res = await client.post(
                    f"{self.base_url}/api/generate",
                    json={"model": model, "prompt": prompt, "stream": False},
                )
                res.raise_for_status()
                data = res.json()
        except Exception as exc:
            record_usage(**meta, usage=None, prompt_text=prompt, latency_ms=_ms(t0), success=False,
                         error_code=_error_code(exc))
            raise
        record_usage(**meta, usage=usage_from_ollama(data), prompt_text=prompt,
                     completion_text=data.get("response", ""), latency_ms=_ms(t0))
        return data["response"]

    async def chat_stream(self, prompt: str, model: str | None = None) -> AsyncGenerator[str, None]:
        t0 = time.perf_counter()
        parts: list[str] = []
        box: dict = {}
        ok, err = True, None
        if _use_openai():
            meta = dict(provider="openai", model=settings.openai_model, operation="chat", endpoint="chat/completions")
        else:
            model = model or settings.chat_model
            meta = dict(provider="ollama", model=model, operation="chat", endpoint="/api/generate")
        try:
            if _use_openai():
                async for token in self._openai_chat_stream(prompt, box):
                    parts.append(token)
                    yield token
            else:
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
                                    parts.append(token)
                                    yield token
                                if data.get("done"):
                                    box["data"] = data
                                    break
        except GeneratorExit:            # 呼叫端提早關閉串流（例如使用者中斷）→ 仍記錄已產生部分
            raise
        except BaseException as exc:
            ok, err = False, _error_code(exc)
            raise
        finally:
            usage = (usage_from_openai(box.get("data")) if meta["provider"] == "openai"
                     else usage_from_ollama(box.get("data")))
            record_usage(**meta, usage=usage, prompt_text=prompt, completion_text="".join(parts),
                         latency_ms=_ms(t0), success=ok, error_code=err, request_id=box.get("id"))

    async def embed(self, text: str) -> list[float]:
        return (await self.embed_many([text]))[0]

    async def embed_many(self, texts: list[str], batch_size: int | None = None) -> list[list[float]]:
        """
        多段文字 embedding（依序、不併發）。
        openai：/embeddings 的 input 陣列，一次 ≤ EMBED_BATCH_SIZE（預設 16）段，每批一筆 llm_usage
        ollama：/api/embed 一次一段（nomic-embed-text 的 batch 上限較小，保守處理）
        每段都會截斷到 embed_max_chars（安全網）。
        """
        texts = [(t or "")[: settings.embed_max_chars] for t in texts]
        out: list[list[float]] = []
        if _is_openai(settings.embed_provider):
            bs = max(1, batch_size or settings.embed_batch_size)
            model = settings.openai_embed_model
            for i in range(0, len(texts), bs):
                batch = texts[i:i + bs]
                t0 = time.perf_counter()
                meta = dict(provider="openai", model=model, operation="embed", endpoint="embeddings")
                try:
                    data = await self._openai_post(
                        "embeddings", model, "OPENAI_EMBED_MODEL",
                        {"model": model, "input": batch if len(batch) > 1 else batch[0]},
                        settings.openai_timeout,
                    )
                    items = sorted(data["data"], key=lambda x: x.get("index", 0))
                    vecs = [x["embedding"] for x in items]
                    if len(vecs) != len(batch):
                        raise LLMProviderError(f"embedding 回傳筆數 {len(vecs)} ≠ 送出 {len(batch)}")
                except (KeyError, IndexError, TypeError) as e:
                    record_usage(**meta, usage=None, prompt_text="".join(batch), latency_ms=_ms(t0),
                                 success=False, error_code="bad_response")
                    raise LLMProviderError(f"embedding 回應格式無法解析（{e}）")
                except Exception as exc:
                    record_usage(**meta, usage=None, prompt_text="".join(batch), latency_ms=_ms(t0),
                                 success=False, error_code=_error_code(exc))
                    raise
                record_usage(**meta, usage=usage_from_openai(data), prompt_text="".join(batch), latency_ms=_ms(t0))
                out.extend(vecs)
            return out

        model = settings.embed_model
        async with httpx.AsyncClient(timeout=120) as client:
            for t in texts:
                t0 = time.perf_counter()
                meta = dict(provider="ollama", model=model, operation="embed", endpoint="/api/embed")
                try:
                    res = await client.post(f"{self.base_url}/api/embed", json={"model": model, "input": t})
                    res.raise_for_status()
                    data = res.json()
                    vec = data["embeddings"][0]
                except Exception as exc:
                    record_usage(**meta, usage=None, prompt_text=t, latency_ms=_ms(t0), success=False,
                                 error_code=_error_code(exc))
                    raise
                record_usage(**meta, usage=usage_from_ollama(data), prompt_text=t, latency_ms=_ms(t0))
                out.append(vec)
        return out

    async def vision_ocr(self, image_base64: str, filename: str = "") -> str:
        prompt = f"{OCR_PROMPT}文件名稱：{filename}"
        t0 = time.perf_counter()
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
            meta = dict(provider="openai", model=settings.openai_vision_model, operation="vision",
                        endpoint="chat/completions")
            try:
                data = await self._openai_post(
                    "chat/completions", settings.openai_vision_model, "OPENAI_VISION_MODEL",
                    payload, settings.openai_timeout,
                )
                content = self._chat_content(data)
            except Exception as exc:
                record_usage(**meta, usage=None, prompt_text=prompt, latency_ms=_ms(t0), success=False,
                             error_code=_error_code(exc))
                raise
            record_usage(**meta, usage=usage_from_openai(data), prompt_text=prompt, completion_text=content,
                         latency_ms=_ms(t0), request_id=data.get("id"))
            return content
        meta = dict(provider="ollama", model=settings.vision_model, operation="vision", endpoint="/api/generate")
        try:
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
                data = res.json()
        except Exception as exc:
            record_usage(**meta, usage=None, prompt_text=prompt, latency_ms=_ms(t0), success=False,
                         error_code=_error_code(exc))
            raise
        record_usage(**meta, usage=usage_from_ollama(data), prompt_text=prompt,
                     completion_text=data.get("response", ""), latency_ms=_ms(t0))
        return data["response"]

    async def list_models(self) -> list[str]:
        if _use_openai():
            return [settings.openai_model] if settings.openai_model else []
        async with httpx.AsyncClient(timeout=30) as client:
            res = await client.get(f"{self.base_url}/api/tags")
            res.raise_for_status()
            return [m["name"] for m in res.json().get("models", [])]


ollama = OllamaService()
