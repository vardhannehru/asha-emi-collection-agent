"""The AI layer's MCP client. Keeps one connection to the EMI MCP server and does two jobs:
  1. shows the LLM the tools, in the format the Anthropic API expects;
  2. carries the LLM's tool requests to the server and brings the answers back.

If MCP_SERVER_URL is empty, or the server is down, there are simply no tools, and a call runs as before.
"""
import asyncio
import os
from contextlib import suppress

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

UNAVAILABLE = "That lookup is not available right now."


class LookupFailed(Exception):
    """A tool call that did not produce an answer. The message is safe to show to the LLM."""


class McpClient:
    def __init__(self, url: str, token: str, call_timeout: float = 3.0, retry_seconds: float = 5.0):
        self.url, self.token = url, token
        self.call_timeout, self.retry_seconds = call_timeout, retry_seconds
        self._session: ClientSession | None = None
        self._tools: list = []
        self._runner: asyncio.Task | None = None
        self._stop = asyncio.Event()
        self._ready = asyncio.Event()

    @classmethod
    def from_env(cls) -> "McpClient":
        return cls(os.getenv("MCP_SERVER_URL", "").strip(), os.getenv("MCP_TOKEN", "").strip())

    # ------------------------------------------------------------ connection --
    async def start(self, wait: float = 3.0) -> None:
        """Connect in the background. Waits a moment so the very first call already sees the tools."""
        if not self.url or self._runner:
            return
        self._runner = asyncio.create_task(self._run())
        with suppress(asyncio.TimeoutError):
            await asyncio.wait_for(self._ready.wait(), wait)

    async def stop(self) -> None:
        self._stop.set()
        if self._runner:
            with suppress(asyncio.CancelledError, asyncio.TimeoutError, Exception):
                await asyncio.wait_for(self._runner, 3)
            self._runner = None

    async def _run(self) -> None:
        """Owns the connection, and reconnects if it drops, for as long as the AI layer is running."""
        headers = {"Authorization": f"Bearer {self.token}"}
        while not self._stop.is_set():
            try:
                async with streamablehttp_client(self.url, headers=headers) as (read, write, _):
                    async with ClientSession(read, write) as session:
                        await session.initialize()
                        self._tools = (await session.list_tools()).tools
                        self._session = session
                        print(f"[mcp] connected to {self.url}, tools: {', '.join(t.name for t in self._tools)}")
                        self._ready.set()
                        await self._stop.wait()
            except asyncio.CancelledError:
                raise
            except BaseException as error:
                print(f"[mcp] not connected ({error}); trying again in {self.retry_seconds:.0f}s")
            finally:
                self._session = None
                self._ready.clear()
            with suppress(asyncio.TimeoutError):
                await asyncio.wait_for(self._stop.wait(), self.retry_seconds)

    def status(self) -> dict:
        return {"enabled": bool(self.url), "connected": self._session is not None, "tools": [t.name for t in self._tools]}

    # ------------------------------------------------------------------ tools --
    def tools_for_llm(self, allow: set[str], hidden: tuple[str, ...] = ("loan_id",)) -> list[dict]:
        """The allowed tools in the Anthropic API's format. Arguments the host fills in itself (hidden)
        are removed, so the LLM never sees or sets them."""
        tools = []
        for tool in self._tools if self._session else []:
            if tool.name not in allow:
                continue
            schema = {k: v for k, v in tool.inputSchema.items() if k != "$schema"}
            schema["properties"] = {k: v for k, v in schema.get("properties", {}).items() if k not in hidden}
            schema["required"] = [k for k in schema.get("required", []) if k not in hidden]
            tools.append({"name": tool.name, "description": tool.description or "", "input_schema": schema})
        return tools

    async def call(self, name: str, arguments: dict, fixed: dict | None = None) -> str:
        """Run one tool on the server and return its answer as text.
        `fixed` values (for example this call's loan_id) always win, so the LLM cannot ask about another borrower."""
        session = self._session
        if session is None:
            raise LookupFailed(UNAVAILABLE)
        try:
            result = await asyncio.wait_for(session.call_tool(name, {**(arguments or {}), **(fixed or {})}), self.call_timeout)
        except Exception as error:
            print(f"[mcp] {name} failed: {error}")
            raise LookupFailed(UNAVAILABLE) from error
        text = "\n".join(block.text for block in result.content if block.type == "text")
        if result.isError:
            raise LookupFailed(text or UNAVAILABLE)
        return text