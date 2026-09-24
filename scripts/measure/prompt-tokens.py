"""单次请求 prompt_tokens 曲线：验证"上下文只带最近 40 条"让 prompt 不再随会话长度线性增长。

用后端接口登录演示账号，为指定角色新建一个空会话，连续发送 N 条短消息，从每次 SSE 的 usage 帧
记录 prompt_tokens，输出第 1、10、20、40、50、60 条时的数值与完整曲线（CSV）。上下文窗口是 40 条
ContextEntry（用户 + 助手各算一条），所以第 21 条起窗口填满，曲线应在那之后趋于平稳。
结束后删除本脚本创建的会话。需要后端配置真实 DeepSeek Key：AI_MOCK=1 时没有 usage 帧，
只能验证脚本本身能跑通（每条记为 -）。

复现（只用标准库）：
    python scripts/measure/prompt-tokens.py --api http://localhost:8022 \
        --user demo --password demo123 --character 陈千语 --count 60
"""

import argparse
import json
import sys
import urllib.error
import urllib.request

REPORT_POINTS = (1, 10, 20, 40, 50, 60)


def request_json(
    api: str, method: str, path: str, token: str | None, body: object | None
) -> object:
    """向后端发一次 JSON 请求；4xx/5xx 时打印 detail 并退出。"""
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(f"{api}{path}", data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as exc:
        sys.exit(f"{method} {path} -> {exc.code}: {exc.read().decode('utf-8')}")
    return json.loads(raw) if raw else None


def chat_usage(
    api: str, token: str, conversation_id: int, text: str
) -> tuple[int | None, int | None]:
    """✅ 发送一条消息并读完 SSE，返回 usage 帧里的 (prompt_tokens, prompt_cache_hit_tokens)。

    没有 usage 帧时两者都是 None；上游没带缓存命中字段时第二项为 None。
    """
    req = urllib.request.Request(
        f"{api}/api/conversations/{conversation_id}/chat",
        data=json.dumps({"text": text}).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
    )
    prompt_tokens = None
    cache_hit = None
    try:
        with urllib.request.urlopen(req) as resp:
            # urllib 按行读取分块响应，每来一行就处理，不等整个流结束
            for raw in resp:
                line = raw.decode("utf-8").strip()
                if not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if payload == "[DONE]":
                    break
                frame = json.loads(payload)
                if "usage" in frame:
                    prompt_tokens = frame["usage"]["prompt_tokens"]
                    cache_hit = frame["usage"].get("prompt_cache_hit_tokens")
                if "error" in frame:
                    print(f"  上游错误：{frame['error']}", file=sys.stderr)
    except urllib.error.HTTPError as exc:
        sys.exit(f"chat -> {exc.code}: {exc.read().decode('utf-8')}")
    return prompt_tokens, cache_hit


def main() -> None:
    """登录、建会话、连续发送并输出曲线。"""
    parser = argparse.ArgumentParser(description="测量连续对话中每次请求的 prompt_tokens")
    parser.add_argument("--api", default="http://localhost:8000", help="后端根地址，不含 /api")
    parser.add_argument("--user", default="demo")
    parser.add_argument("--password", default="demo123")
    parser.add_argument("--character", default="陈千语")
    parser.add_argument("--count", type=int, default=60, help="连续发送的消息条数")
    args = parser.parse_args()

    credentials = {"username": args.user, "password": args.password}
    login = request_json(args.api, "POST", "/api/auth/login", None, credentials)
    token: str = login["token"]
    conversation = request_json(
        args.api, "POST", "/api/conversations", token, {"character_name": args.character}
    )
    conversation_id: int = conversation["id"]
    print(f"会话 {conversation_id}（{args.character}），连续发送 {args.count} 条")

    curve: list[int | None] = []
    hits: list[int | None] = []
    try:
        for i in range(1, args.count + 1):
            tokens, hit = chat_usage(
                args.api, token, conversation_id, f"第 {i} 条：请用一句话回复我。"
            )
            curve.append(tokens)
            hits.append(hit)
            shown_hit = "" if hit is None else f"（缓存命中 {hit}）"
            shown = "-" if tokens is None else tokens
            print(f"  #{i:<3} prompt_tokens = {shown}{shown_hit}", flush=True)
    finally:
        request_json(args.api, "DELETE", f"/api/conversations/{conversation_id}", token, None)

    print("\n| 第 n 条 | prompt_tokens | 缓存命中 |\n| --- | --- | --- |")
    for n in REPORT_POINTS:
        if n <= len(curve):
            value, hit = curve[n - 1], hits[n - 1]
            print(f"| {n} | {'-' if value is None else value} | {'-' if hit is None else hit} |")
    print("\n完整曲线（CSV）：" + ",".join("-" if v is None else str(v) for v in curve))
    print("缓存命中曲线（CSV）：" + ",".join("-" if v is None else str(v) for v in hits))


if __name__ == "__main__":
    main()
