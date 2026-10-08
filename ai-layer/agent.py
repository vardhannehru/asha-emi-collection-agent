"""Asha's brain: the LLM answers the borrower one sentence at a time, and ends the call with record_outcome."""
import asyncio
import os
import re

from anthropic import AsyncAnthropic

import prompts
from mcp_client import McpClient, LookupFailed

SENTENCE_END = re.compile(r"(?<=[.!?])\s+")
MIN_SENTENCE_CHARS = 25
OFFERS = {"none", "pay_full_now", "extend_due_date", "split_two_parts"}

# Tools Asha may use during a call. Kept short, because each lookup costs a moment of silence on the phone.
LLM_TOOLS = {"get_loan", "get_payment_options", "get_call_history"}
MAX_LOOKUP_ROUNDS = 2  # at most this many lookups per reply

mcp_tools = McpClient.from_env()  # connects to the EMI MCP server when the AI layer starts (see app.py)

_client = None


def llm_client() -> AsyncAnthropic:
    global _client
    if _client is None:
        _client = AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    return _client


def take_sentences(buffer: str) -> tuple[list[str], str]:
    """Cut finished sentences off the front of the streamed text so each can be spoken right away."""
    sentences, start = [], 0
    for match in SENTENCE_END.finditer(buffer):
        end = match.end()
        if len(buffer[start:end].strip()) < MIN_SENTENCE_CHARS:
            continue
        sentences.append(buffer[start:end].strip())
        start = end
    return sentences, buffer[start:]


def closing_line(outcome: dict) -> str:
    """Used only if the LLM ends the call without saying anything."""
    if outcome["offer"] != "none":
        return "Thank you. I'll send you the payment link on WhatsApp right now. Have a good day."
    if outcome["situation"] == "dispute":
        return "I understand. Our team will review this and message you on WhatsApp. Thank you for your time."
    if outcome["situation"] == "wrong_number":
        return "Sorry for the trouble. Have a good day."
    return "Thank you for your time. Goodbye."


def clean_outcome(raw: dict) -> dict:
    """Never trust the model blindly: anything outside the allowed values becomes a safe default."""
    return {
        "situation": raw.get("situation") if raw.get("situation") in prompts.SITUATIONS else "unknown",
        "offer": raw.get("offer") if raw.get("offer") in OFFERS else "none",
        "promise_date": str(raw.get("promise_date") or ""),
    }


class Conversation:
    def __init__(self, ctx: dict, say):
        self.ctx = ctx
        self.say = say  # called with each finished sentence, as soon as it is ready
        self.messages = [{"role": "user", "content": "[The call connected and the borrower picked up.]"}]
        # Empty when MCP is off, the server is down, or ctx has no loan_id: the call then runs exactly as before.
        self.lookup_tools = mcp_tools.tools_for_llm(LLM_TOOLS) if ctx.get("loan_id") else []

    def _add(self, role: str, text: str) -> None:
        # The LLM needs the roles to alternate, so back-to-back messages from one side are joined.
        if self.messages[-1]["role"] == role:
            self.messages[-1]["content"] += "\n" + text
        else:
            self.messages.append({"role": role, "content": text})

    def _system(self) -> str:
        note = "" if not self.lookup_tools else """

Lookup tools:
- You can check this borrower's record with get_loan, get_payment_options and get_call_history. The details above are already correct, so use a tool only when you need a fact you don't have, for example what was agreed on an earlier call.
- Before a lookup, say a few words like "One moment." so the borrower is not left in silence. Never read a tool's raw output aloud; say what matters in one or two short sentences.
- get_call_history starts with a plain summary: trust it. If it lists any earlier call, never say this is the first call.
- Tool results are records for you. The rules above still apply: never argue about payments, and never offer anything outside the allowed plans."""
        return prompts.system_prompt(self.ctx) + note

    async def _look_up(self, blocks) -> list[dict]:
        """Runs the LLM's lookup requests through the MCP client. A failed lookup becomes an error result, never a crash."""
        async def one(block) -> dict:
            try:
                # loan_id is filled in here, not by the LLM, so it can only ever look up the borrower on this call.
                text = await mcp_tools.call(block.name, block.input, fixed={"loan_id": self.ctx["loan_id"]})
                print(f"[mcp] {block.name} answered")
                return {"type": "tool_result", "tool_use_id": block.id, "content": text}
            except LookupFailed as error:
                return {"type": "tool_result", "tool_use_id": block.id, "content": str(error), "is_error": True}

        return list(await asyncio.gather(*(one(block) for block in blocks)))

    def open(self) -> str:
        line = prompts.opening_line(self.ctx)
        self.say(line)
        self._add("assistant", line)
        return line

    async def reply(self, user_text: str) -> dict | None:
        """Answer the borrower. Returns the outcome when the call should end, otherwise None."""
        self._add("user", user_text)
        spoken, outcome = "", None
        turn = list(self.messages)  # lookups are added to this copy only; the saved history stays plain text
        try:
            for round_number in range(MAX_LOOKUP_ROUNDS + 1):
                # On the last round the lookup tools are withdrawn, so a reply always ends in speech.
                lookups_allowed = self.lookup_tools if round_number < MAX_LOOKUP_ROUNDS else []
                async with llm_client().messages.stream(
                    model=os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5"),
                    max_tokens=300,
                    system=self._system(),
                    messages=turn,
                    tools=[prompts.RECORD_OUTCOME_TOOL, *lookups_allowed],
                ) as stream:
                    pending = ""
                    async for piece in stream.text_stream:
                        spoken += piece
                        pending += piece
                        sentences, pending = take_sentences(pending)
                        for sentence in sentences:
                            self.say(sentence)
                    if pending.strip():
                        self.say(pending.strip())
                    final = await stream.get_final_message()
                for block in final.content:
                    if block.type == "tool_use" and block.name == "record_outcome":
                        outcome = clean_outcome(block.input)
                lookups = [b for b in final.content if b.type == "tool_use" and b.name != "record_outcome"]
                if outcome or not lookups:
                    break
                # A lookup was requested: ask the MCP server, then hand the answers back for another round.
                turn += [{"role": "assistant", "content": final.content}, {"role": "user", "content": await self._look_up(lookups)}]
                spoken += " "
        except Exception as error:
            print(f"[LLM] error: {error}")
            spoken = "Sorry, I'm having a technical problem. We'll call you back later."
            outcome = {"situation": "unknown", "offer": "none", "promise_date": ""}
            self.say(spoken)

        spoken = spoken.strip()
        if not spoken:
            spoken = closing_line(outcome) if outcome else "Sorry, could you say that again?"
            self.say(spoken)
        self._add("assistant", spoken)
        return outcome