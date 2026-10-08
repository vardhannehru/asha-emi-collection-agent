"""Talk to Asha in the terminal. You type as the borrower. Type 'quit' to stop.
This is a test tool: it makes up the loan details that the backend will send at the start of a real call."""
import asyncio
import sys
from datetime import date, timedelta
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

from agent import Conversation  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")

TODAY = date.today()
CTX = {
    "lender": "Demo Finance",
    "today": TODAY.isoformat(),
    "offers": {
        "pay_full_now": "Pay the full 6,000 rupees today",
        "extend_due_date": f"Pay the full 6,000 rupees within 5 days, by {(TODAY + timedelta(days=5)).strftime('%d %b %Y')}",
        "split_two_parts": "Pay 3,000 rupees today and the remaining 3,000 rupees within 15 days",
    },
    "loan": {"name": "Vardhan", "amount_due": 6000, "due_date": (TODAY - timedelta(days=4)).isoformat(), "days_overdue": 4},
}


async def main() -> None:
    conversation = Conversation(CTX, say=lambda sentence: print(f"Asha: {sentence}"))
    conversation.open()
    while True:
        try:
            text = (await asyncio.to_thread(input, "You:  ")).strip()
        except EOFError:
            break
        if text.lower() == "quit":
            break
        if not text:
            continue
        outcome = await conversation.reply(text)
        if outcome:
            print(f"\n[call ended] {outcome}")
            break


asyncio.run(main())