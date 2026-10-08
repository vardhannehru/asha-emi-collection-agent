"""Python copy of the read-only parts of backend-layer/rules.js. The MCP server only looks things up,
so it does not need everything the backend has, but every number and rule here must match rules.js exactly."""
from datetime import date, datetime, timedelta, timezone

CALL_START_HOUR = 9
CALL_END_HOUR = 18
MAX_CALLS_PER_DAY = 2
MAX_EXTENSION_DAYS = 5
SPLIT_SECOND_PART_DAYS = 15

OFFERS = {
    "pay_full_now": "Pay the full amount today",
    "extend_due_date": f"Pay the full amount within {MAX_EXTENSION_DAYS} days",
    "split_two_parts": f"Pay half today and the other half within {SPLIT_SECOND_PART_DAYS} days",
}

NO_CALL_STATUSES = {
    "paid": "Loan is already paid",
    "promised": "Borrower already promised to pay",
    "disputed": "Loan is under dispute review",
    "do_not_call": "Marked as wrong number",
}

IST = timezone(timedelta(hours=5, minutes=30))


def now_ist() -> datetime:
    return datetime.now(IST)


def today_ist() -> str:
    return now_ist().date().isoformat()


def enforce_call_hours() -> bool:
    import os
    return os.getenv("ENFORCE_CALL_HOURS", "true").strip().lower() != "false"


def can_call(status: str, calls_today: int, hour: int | None = None) -> tuple[bool, str]:
    """Returns (allowed, reason), same logic as canCall in rules.js."""
    if status in NO_CALL_STATUSES:
        return False, NO_CALL_STATUSES[status]
    if calls_today >= MAX_CALLS_PER_DAY:
        return False, f"Already called {calls_today} times today (max {MAX_CALLS_PER_DAY})"
    hour = now_ist().hour if hour is None else hour
    if enforce_call_hours() and not (CALL_START_HOUR <= hour < CALL_END_HOUR):
        end12 = CALL_END_HOUR - 12
        return False, f"Outside calling hours ({CALL_START_HOUR} AM - {end12} PM IST)."
    return True, "OK"


def days_overdue(due_date: str, today: str) -> int:
    d1 = date.fromisoformat(due_date)
    d2 = date.fromisoformat(today)
    return max((d2 - d1).days, 0)


def add_days(iso_date: str, days: int) -> str:
    return (date.fromisoformat(iso_date) + timedelta(days=days)).isoformat()


def payment_plan(offer: str, amount_due: int, today: str, requested_date: str = "") -> dict:
    """The server decides the amount and date. The LLM only picks which allowed plan was agreed."""
    if offer == "pay_full_now":
        return {"amount": amount_due, "pay_by": today}
    if offer == "split_two_parts":
        return {"amount": -(-amount_due // 2), "pay_by": today}  # ceiling division, same as Math.ceil
    if offer == "extend_due_date":
        latest = add_days(today, MAX_EXTENSION_DAYS)
        wanted = requested_date if _is_date(requested_date) else latest
        wanted = max(min(wanted, latest), today)
        return {"amount": amount_due, "pay_by": wanted}
    raise ValueError(f"Unknown offer: {offer}")


def _is_date(value: str) -> bool:
    try:
        date.fromisoformat(value)
        return True
    except (ValueError, TypeError):
        return False


def describe() -> list[str]:
    hours = f"Calls only between {CALL_START_HOUR} AM and {CALL_END_HOUR - 12} PM IST"
    if not enforce_call_hours():
        hours += " (switched off for testing)"
    return [
        hours,
        f"At most {MAX_CALLS_PER_DAY} calls per loan per day",
        "No calls to paid, promised, disputed or wrong-number loans",
        *[f"Allowed plan: {text}" for text in OFFERS.values()],
    ]