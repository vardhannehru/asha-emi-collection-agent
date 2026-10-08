"""Twilio 'listen and reply' phone calls. Twilio's own <Gather input="speech"> does the listening
(speech to text) and <Say> speaks Asha's words in Twilio's built-in voice. No Deepgram or ElevenLabs
needed for this: real phone calls work before the AI layer has its own ears and mouth.

The backend (backend-layer/twilio.js, backend-layer/app.js) calls these as plain HTTP requests, one
per webhook, since a Twilio call is a request/response conversation, not a live connection like the
browser call's WebSocket."""
from fastapi import APIRouter, HTTPException

from agent import Conversation

router = APIRouter(prefix="/gather")
SESSIONS: dict[int, Conversation] = {}


class Collector:
    """Stands in for the browser call's speaker: it just remembers each sentence Asha says."""

    def __init__(self) -> None:
        self.said: list[str] = []

    def __call__(self, sentence: str) -> None:
        self.said.append(sentence)


def session_for(call_id) -> Conversation:
    conv = SESSIONS.get(int(call_id))
    if conv is None:
        raise HTTPException(404, "No phone session for this call")
    return conv


@router.post("/start")
async def start(ctx: dict):
    """The borrower answered: speak the opening line."""
    conv = Conversation(ctx, say=Collector())
    SESSIONS[int(ctx["call_id"])] = conv
    line = conv.open()
    print(f"[gather] call {ctx['call_id']} with {ctx['loan']['name']}")
    return {"text": line, "ended": False}


@router.post("/reply")
async def reply(body: dict):
    """Twilio heard the borrower: run one full turn and return everything Asha said."""
    conv = session_for(body["call_id"])
    text = body["text"].strip()
    print(f"[gather] borrower: {text}")
    collector = Collector()
    conv.say = collector  # swap in a fresh collector for this turn only
    outcome = await conv.reply(text)
    return {"text": " ".join(collector.said).strip(), "ended": outcome is not None, "outcome": outcome}


@router.post("/end")
async def end(body: dict):
    SESSIONS.pop(int(body["call_id"]), None)
    return {"ok": True}
