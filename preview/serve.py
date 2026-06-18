#!/usr/bin/env python3
"""静态文件 + DeepSeek/Anthropic 代理。DeepSeek 不能从浏览器直连（跨域），必须走此服务。"""
import http.server
import json
import os
import socketserver
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8765


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt, *args):
        if self.path.startswith("/api/"):
            print(f"[proxy] {args[0]}")

    def end_headers(self):
        # 预览阶段禁用缓存，避免浏览器加载旧的 index.html / jsx
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        if self.path == "/api/llm-proxy":
            self.handle_llm_proxy()
        else:
            super().do_POST()

    def handle_llm_proxy(self):
        try:
            self._handle_llm_proxy()
        except Exception as e:  # 最后兜底：任何异常都返回 JSON，绝不让连接裸断
            try:
                self.send_json(502, {"error": {"message": f"代理内部错误：{e}"}})
            except Exception:
                pass

    def _handle_llm_proxy(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self.send_json(400, {"error": {"message": "invalid json body"}})
            return

        provider = body.get("provider", "deepseek")
        api_key = (body.get("apiKey") or "").strip()
        default_model = {
            "deepseek": "deepseek-chat",
            "gemini": "gemini-2.5-flash",
        }.get(provider, "claude-sonnet-4-20250514")
        model = body.get("model") or default_model
        # 服务端兜底：残缺/错误的模型名（如 "claude"、"anthropic"）一律回退默认
        if provider == "anthropic" and not (model.startswith("claude-") and len(model) >= 12):
            model = default_model
        elif provider == "deepseek" and not model.startswith("deepseek-"):
            model = default_model
        messages = body.get("messages") or []
        images = body.get("images") or []
        max_tokens = int(body.get("max_tokens") or 2000)

        if not api_key:
            self.send_json(401, {"error": {"message": "missing apiKey"}})
            return

        user_content = messages[0]["content"] if messages else ""

        if provider == "gemini":
            # 图片识别走 Gemini：图片以 inline_data(base64) 形式随文本一起发
            url = (
                "https://generativelanguage.googleapis.com/v1beta/models/"
                f"{model}:generateContent"
            )
            parts = []
            for img in images:
                parts.append({
                    "inline_data": {
                        "mime_type": img.get("media_type", "image/jpeg"),
                        "data": img.get("data", ""),
                    }
                })
            parts.append({"text": user_content})
            payload = {
                "contents": [{"parts": parts}],
                "generationConfig": {"maxOutputTokens": max_tokens, "temperature": 0.2},
            }
            headers = {"Content-Type": "application/json", "x-goog-api-key": api_key}
        elif provider == "deepseek":
            url = "https://api.deepseek.com/chat/completions"
            payload = {
                "model": model,
                "messages": messages,
                "max_tokens": max_tokens,
                "temperature": 0.3,
            }
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            }
        else:
            url = "https://api.anthropic.com/v1/messages"
            payload = {
                "model": model,
                "max_tokens": max_tokens,
                "messages": [{"role": "user", "content": user_content}],
            }
            headers = {
                "Content-Type": "application/json",
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
            }

        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        data = None
        last_err = None
        # 瞬时断连（VPN/代理抖动）会触发 reset/refused/RemoteDisconnected，自动重试几次
        for attempt in range(4):
            try:
                with urllib.request.urlopen(req, timeout=90) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                break
            except urllib.error.HTTPError as e:
                detail = e.read().decode("utf-8", errors="replace")
                try:
                    err_obj = json.loads(detail)
                    if provider == "deepseek":
                        msg = err_obj.get("error", {}).get("message") or detail
                    else:
                        msg = err_obj.get("error", {}).get("message") or err_obj.get("message") or detail
                except json.JSONDecodeError:
                    msg = detail or e.reason
                self.send_json(e.code, {"error": {"message": msg}})
                return
            except (urllib.error.URLError, ConnectionError, OSError) as e:
                last_err = getattr(e, "reason", e)
                time.sleep(0.8 * (attempt + 1))
                continue

        if data is None:
            self.send_json(502, {"error": {"message": f"上游连接失败（已重试）：{last_err}。多为本地网络/VPN 抖动，请稍后再试。"}})
            return

        if provider == "gemini":
            cands = data.get("candidates") or []
            parts = (cands[0].get("content", {}).get("parts", []) if cands else [])
            text = "".join(p.get("text", "") for p in parts)
            if not text and cands:
                # 触发了安全过滤或空响应时给出可读原因
                reason = cands[0].get("finishReason") or "无内容"
                text = f"（图片未能识别：{reason}）"
        elif provider == "deepseek":
            text = (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
        else:
            text = "".join(
                b.get("text", "")
                for b in data.get("content", [])
                if b.get("type") == "text"
            )
        self.send_json(200, {"text": text})

    def send_json(self, code, obj):
        raw = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


class ThreadingHTTPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    # 多线程：单个 LLM 请求（最长 90s）不会阻塞页面/其他请求
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    os.chdir(ROOT)
    with ThreadingHTTPServer(("", PORT), Handler) as httpd:
        print(f"食记 preview: http://127.0.0.1:{PORT}/preview/index.html")
        print("LLM 代理: POST /api/llm-proxy（多线程，支持上游抖动自动重试）")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n已停止")
