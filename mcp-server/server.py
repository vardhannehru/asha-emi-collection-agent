"""MCP server "EMI Tools". Owns the tools (tools.py) and answers any MCP client that connects, over HTTP.
It listens on 127.0.0.1 only, and every request needs the MCP_TOKEN. Never expose this through ngrok."""
import hmac
import os
from pathlib import Path

import uvicorn
from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP

from tools import register_tools

load_dotenv(Path(__file__).resolve().parent / ".env")

PORT = int(os.getenv("MCP_PORT", "5101"))
TOKEN = os.getenv("MCP_TOKEN", "")

if not TOKEN:
    raise SystemExit("MCP_TOKEN is missing. Add MCP_TOKEN=<a long random string> to mcp-server/.env.")

mcp = FastMCP(
    "emi-tools",
    instructions="Read-only tools for the EMI collection agent: loans, payment plans, call history and the "
                 "calling rules. Amounts and dates always come from these tools; never work them out yourself.",
    host="127.0.0.1",
    port=PORT,
    json_response=True,
    stateless_http=True,  # every request stands alone, so a restart never leaves a client holding a dead session
)
register_tools(mcp)

app = mcp.streamable_http_app()


class CheckToken:
    """ASGI middleware: runs in front of every request. Blocks anything without the right bearer token,
    and blocks anything sent by a browser (a real MCP client never sends an Origin header)."""

    def __init__(self, inner_app):
        self.inner_app = inner_app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.inner_app(scope, receive, send)

        headers = dict(scope["headers"])  # header names arrive as lowercase bytes
        if headers.get(b"origin"):
            return await self._reject(send, 403, "Browsers are not allowed here")
        given = headers.get(b"authorization", b"").decode().removeprefix("Bearer ")
        if not hmac.compare_digest(given, TOKEN):
            return await self._reject(send, 401, "Missing or wrong token")
        return await self.inner_app(scope, receive, send)

    @staticmethod
    async def _reject(send, status: int, message: str) -> None:
        body = f'{{"error": "{message}"}}'.encode()
        await send({"type": "http.response.start", "status": status, "headers": [(b"content-type", b"application/json")]})
        await send({"type": "http.response.body", "body": body})


app = CheckToken(app)

if __name__ == "__main__":
    print(f"EMI MCP server on http://127.0.0.1:{PORT}/mcp")
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")