"""AI layer web server. The backend connects here for every browser call. Phone calls go through
gather_mode.py instead (Twilio does its own listening and speaking there).
  GET  /health       is the AI layer alive?
  WS   /ws/browser   text-only browser call (no voice: phone calls use Twilio's own listening and speaking).

The backend sends:  {"type": "emi_context", ...} first (the loan and the plans), then {"type": "text", "text": "..."}
The AI layer sends: {"type": "voice_segment", "text": ..., "audio": ""} for each sentence Asha says
                    {"type": "no_speech"} if an audio message is sent (audio is not supported)
                    {"type": "reply_done"} or {"type": "call_end"}
                    {"event": "agent", "kind": "turn" | "outcome" | "finish", ...} for the backend to save
"""
import asyncio
import base64
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

from fastapi import FastAPI, WebSocket, WebSocketDisconnect  # noqa: E402

from agent import Conversation, mcp_tools  # noqa: E402
from gather_mode import router as gather_router  # noqa: E402

if not os.getenv("ANTHROPIC_API_KEY"):
    raise RuntimeError("ANTHROPIC_API_KEY missing in ai-layer/.env")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await mcp_tools.start()  # connects to the EMI MCP server in the background; does nothing if MCP_SERVER_URL is empty
    yield
    await mcp_tools.stop()


app = FastAPI(title="EMI agent AI layer", lifespan=lifespan)
app.include_router(gather_router)


@app.get("/health")
def health():
    return {
        "ok": True,
        "brain": os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5"),
        "ears": "Twilio's speech-to-text (phone calls)",
        "mouth": "Twilio's voice (phone calls)",
        "mcp": mcp_tools.status(),
    }


class BrowserSession:
    def __init__(self, ws: WebSocket, ctx: dict):
        self.ws = ws
        self.ctx = ctx
        self.conv = Conversation(ctx, say=self.say)
        self.outbox: asyncio.Queue = asyncio.Queue()
        self.audio_queue: asyncio.Queue = asyncio.Queue()
        self.said: list[str] = []
        self.ended = False

    def send(self, payload: dict) -> None:
        self.outbox.put_nowait(payload)

    def say(self, sentence: str) -> None:
        self.said.append(sentence)
        self.audio_queue.put_nowait((sentence, asyncio.ensure_future(self._synthesize(sentence))))

    async def _synthesize(self, sentence: str) -> str:
        return ""

    async def audio_deliverer(self) -> None:
        while True:
            sentence, future = await self.audio_queue.get()
            audio_b64 = await future
            self.send({"type": "voice_segment", "text": sentence, "audio": audio_b64})

    async def sender(self) -> None:
        try:
            while True:
                await self.ws.send_text(json.dumps(await self.outbox.get()))
        except Exception:
            pass  # the page closed; nothing left to send to

    def report(self, kind: str, **fields) -> None:
        self.send({"event": "agent", "kind": kind, **fields})

    def open(self) -> None:
        self.said = []
        line = self.conv.open()
        self.report("turn", role="agent", text=line)

    async def take_turn(self, text: str) -> None:
        self.report("turn", role="borrower", text=text)
        self.said = []
        outcome = await self.conv.reply(text)
        self.report("turn", role="agent", text=" ".join(self.said))
        if outcome:
            self.ended = True
            self.report("outcome", **outcome)
            self.send({"type": "call_end"})
            self.report("finish")
        else:
            self.send({"type": "reply_done"})

    async def run(self) -> None:
        sender = asyncio.create_task(self.sender())
        deliverer = asyncio.create_task(self.audio_deliverer())
        try:
            self.open()
            while True:
                message = json.loads(await self.ws.receive_text())
                kind = message.get("type")
                if self.ended:
                    continue
                if kind == "text" and (message.get("text") or "").strip():
                    await self.take_turn(message["text"].strip())
                elif kind == "audio" and message.get("data"):
                    self.send({"type": "no_speech"})
        except WebSocketDisconnect:
            pass
        finally:
            sender.cancel()
            deliverer.cancel()


@app.websocket("/ws/browser")
async def browser(ws: WebSocket):
    await ws.accept()
    ctx = None
    try:
        while ctx is None:
            message = json.loads(await ws.receive_text())
            if message.get("type") == "emi_context":
                ctx = message
    except WebSocketDisconnect:
        return
    print(f"[browser] call {ctx['call_id']} with {ctx['loan']['name']}")
    await BrowserSession(ws, ctx).run()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.getenv("AI_LAYER_PORT", "8001")))
