"""
ModaOne ModelSpace（OpenAI Chat Completions 相容）連線測試腳本。

用法（專案根目錄）：
    python backend/scripts/test_modaone.py

設定來源（優先順序：已存在的環境變數 > 專案根目錄 .env.modaone）：
    OPENAI_BASE_URL  例：https://modaone-llm-api.dginfra.gov.tw/api/v1（不含 /chat/completions）
    OPENAI_API_KEY
    OPENAI_MODEL     例：Llama-3.3-70B-Instruct
    OPENAI_TIMEOUT   選填，預設 180 秒

只依賴 httpx、python-dotenv。
"""
import json
import os
import sys

# Windows 主控台（cp950）印中文 / 特殊字元時避免 UnicodeEncodeError
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
import time
from pathlib import Path

try:
    import httpx
except ImportError:
    sys.exit("[ERROR] 缺少 httpx，請先 pip install httpx python-dotenv")

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = ROOT / ".env.modaone"
PROMPT = "用一句話介紹士林地方法院"


def _simple_load_env(path: Path) -> None:
    """未安裝 python-dotenv 時的簡易 KEY=VALUE 解析（不覆寫已存在的環境變數）"""
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        key, val = key.strip(), val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val


def load_config() -> dict:
    if ENV_FILE.exists():
        if load_dotenv is None:
            _simple_load_env(ENV_FILE)
            print(f"[INFO] 已讀取 {ENV_FILE}（未安裝 python-dotenv，使用簡易解析）")
        else:
            load_dotenv(ENV_FILE, override=False)  # 已存在的環境變數優先
            print(f"[INFO] 已讀取 {ENV_FILE}")
    else:
        print(f"[INFO] 找不到 {ENV_FILE}，改用現有環境變數")

    cfg = {
        "base_url": os.getenv("OPENAI_BASE_URL", "").strip().rstrip("/"),
        "api_key": os.getenv("OPENAI_API_KEY", "").strip(),
        "model": os.getenv("OPENAI_MODEL", "").strip(),
        "timeout": int(os.getenv("OPENAI_TIMEOUT", "180") or 180),
    }
    missing = [k for k, v in (("OPENAI_BASE_URL", cfg["base_url"]),
                              ("OPENAI_API_KEY", cfg["api_key"]),
                              ("OPENAI_MODEL", cfg["model"])) if not v]
    if missing:
        print(f"[ERROR] 缺少設定：{', '.join(missing)}")
        print(f"        請複製 {ROOT / '.env.modaone.example'} 為 .env.modaone 並填入值，")
        print("        或直接設定對應的環境變數後再執行。")
        sys.exit(2)
    if cfg["base_url"].endswith("/chat/completions"):
        print("[WARN] OPENAI_BASE_URL 不要包含 /chat/completions（填到 /api/v1 為止），腳本會自動加上")
    return cfg


def print_http_error(res: httpx.Response, body: str) -> None:
    print(f"[FAIL] HTTP {res.status_code}")
    print(f"       body: {body[:3000]}")


def test_non_stream(cfg: dict, url: str, headers: dict) -> bool:
    print("\n=== (a) 非串流 chat ===")
    payload = {
        "model": cfg["model"],
        "messages": [{"role": "user", "content": PROMPT}],
        "stream": False,  # 非串流不可帶 stream_options
    }
    t0 = time.perf_counter()
    try:
        res = httpx.post(url, json=payload, headers=headers, timeout=cfg["timeout"])
    except httpx.HTTPError as e:
        print(f"[FAIL] 連線錯誤：{type(e).__name__}: {e}")
        return False
    elapsed = time.perf_counter() - t0
    if res.status_code >= 400:
        print_http_error(res, res.text)
        return False
    try:
        data = res.json()
        content = data["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError) as e:
        print(f"[FAIL] 回應格式無法解析（{e}）：{res.text[:3000]}")
        return False
    print(f"回覆：{content}")
    print(f"耗時：{elapsed:.2f}s")
    print(f"usage：{json.dumps(data.get('usage'), ensure_ascii=False)}")
    return True


def test_stream(cfg: dict, url: str, headers: dict) -> bool:
    print("\n=== (b) 串流 chat ===")
    payload = {
        "model": cfg["model"],
        "messages": [{"role": "user", "content": PROMPT}],
        "stream": True,
    }
    t0 = time.perf_counter()
    first_token_at = None
    chunks: list[str] = []
    try:
        with httpx.stream("POST", url, json=payload, headers=headers, timeout=cfg["timeout"]) as res:
            if res.status_code >= 400:
                print_http_error(res, res.read().decode("utf-8", errors="replace"))
                return False
            print("逐字：", end="", flush=True)
            for line in res.iter_lines():
                line = line.strip()
                if not line.startswith("data:"):
                    continue
                data_str = line[5:].strip()
                if data_str == "[DONE]":
                    break
                try:
                    data = json.loads(data_str)
                except ValueError:
                    print(f"\n[WARN] 無法解析的 SSE 行：{data_str[:200]}")
                    continue
                if "error" in data:
                    print(f"\n[FAIL] stream error：{data_str[:3000]}")
                    return False
                choices = data.get("choices") or []
                if not choices:
                    continue
                token = (choices[0].get("delta") or {}).get("content")
                if token:
                    if first_token_at is None:
                        first_token_at = time.perf_counter() - t0
                    chunks.append(token)
                    print(token, end="", flush=True)
    except httpx.HTTPError as e:
        print(f"\n[FAIL] 連線錯誤：{type(e).__name__}: {e}")
        return False
    elapsed = time.perf_counter() - t0
    print()
    print(f"完整結果：{''.join(chunks)}")
    if first_token_at is not None:
        print(f"首 token：{first_token_at:.2f}s")
    print(f"總耗時：{elapsed:.2f}s（{len(chunks)} chunks）")
    return bool(chunks)


def main() -> int:
    cfg = load_config()
    url = f"{cfg['base_url']}/chat/completions"
    key = cfg["api_key"]
    print(f"base_url：{cfg['base_url']}")
    print(f"endpoint：{url}")
    print(f"model   ：{cfg['model']}")
    print(f"api_key ：{key[:4]}****（長度 {len(key)}）")
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    ok_a = test_non_stream(cfg, url, headers)
    ok_b = test_stream(cfg, url, headers)
    print("\n=== 結果 ===")
    print(f"非串流：{'OK' if ok_a else 'FAIL'}")
    print(f"串流  ：{'OK' if ok_b else 'FAIL'}")
    return 0 if (ok_a and ok_b) else 1


if __name__ == "__main__":
    sys.exit(main())
