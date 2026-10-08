"""The tools (and one resource) the EMI MCP server offers. All read-only: a client can look things up, never change anything.
Every answer comes from db.py and rules.py, so the money maths lives in one place, mirroring backend-layer/crm.js and rules.js."""
from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

import db
import rules

READ_ONLY = ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True, openWorldHint=False)


def offers_for(loan: dict, today: str) -> dict:
    """Same idea as offersFor in backend-layer/crm.js: plain sentences with the real amounts."""
    words = lambda n: f"{n:,}"
    split = rules.payment_plan("split_two_parts", loan["amount_due"], today)
    later = rules.payment_plan("extend_due_date", loan["amount_due"], today)
    remaining = loan["amount_due"] - split["amount"]
    return {
        "pay_full_now": f"Pay the full {words(loan['amount_due'])} rupees today",
        "extend_due_date": f"Pay the full {words(loan['amount_due'])} rupees within {rules.MAX_EXTENSION_DAYS} days, by {later['pay_by']}",
        "split_two_parts": f"Pay {words(split['amount'])} rupees today and the remaining {words(remaining)} rupees within {rules.SPLIT_SECOND_PART_DAYS} days",
    }


def loan_view(loan: dict, today: str) -> dict:
    """Never includes the phone number: the LLM has no need to see it."""
    count = db.calls_today(loan["id"], today)
    can_call, reason = rules.can_call(loan["status"], count)
    return {
        "id": loan["id"],
        "name": loan["name"],
        "amount_due": loan["amount_due"],
        "due_date": loan["due_date"],
        "days_overdue": rules.days_overdue(loan["due_date"], today),
        "status": loan["status"],
        "calls_today": count,
        "can_call": can_call,
        "blocked_reason": None if can_call else reason,
    }


def register_tools(mcp: FastMCP) -> None:
    @mcp.tool(annotations=READ_ONLY)
    def get_loan(loan_id: int) -> dict:
        """One loan: borrower name, amount due, due date, days overdue, status, calls made today, and whether calling is allowed right now."""
        print(f"[tool] get_loan {loan_id}")
        loan = db.find_loan(loan_id)
        if not loan:
            raise ValueError(f"No loan with id {loan_id}")
        return loan_view(loan, rules.today_ist())

    @mcp.tool(annotations=READ_ONLY)
    def list_overdue_loans() -> dict:
        """Every loan that is past its due date and not yet paid, each with whether the calling rules allow a call right now.
        For the team, not for use during a borrower's call."""
        print("[tool] list_overdue_loans")
        today = rules.today_ist()
        with db.connect() as conn:
            rows = conn.execute("SELECT * FROM loans ORDER BY due_date").fetchall()
        loans = [loan_view(dict(row), today) for row in rows]
        loans = [loan for loan in loans if loan["days_overdue"] > 0 and loan["status"] != "paid"]
        return {"today": today, "count": len(loans), "loans": loans}

    @mcp.tool(annotations=READ_ONLY)
    def get_payment_options(loan_id: int) -> dict:
        """The three payment plans that may be offered to this borrower, with the exact rupee amounts and dates
        already worked out by our rules. Never calculate amounts yourself."""
        print(f"[tool] get_payment_options {loan_id}")
        loan = db.find_loan(loan_id)
        if not loan:
            raise ValueError(f"No loan with id {loan_id}")
        today = rules.today_ist()
        say = offers_for(loan, today)
        plans = []
        for plan in rules.OFFERS:
            worked_out = rules.payment_plan(plan, loan["amount_due"], today)
            plans.append({"plan": plan, "say": say[plan], "amount": worked_out["amount"], "pay_by": worked_out["pay_by"]})
        return {"loan_id": loan["id"], "amount_due": loan["amount_due"], "plans": plans}

    @mcp.tool(annotations=READ_ONLY)
    def get_call_history(loan_id: int, limit: int = 3, include_transcript: bool = False) -> dict:
        """This loan's finished calls, newest first: the borrower's situation, the plan they agreed to, and any
        promised amount and date. Set include_transcript to true when someone asks what was said or agreed on an earlier call."""
        print(f"[tool] get_call_history {loan_id} limit={limit} include_transcript={include_transcript}")
        if not db.find_loan(loan_id):
            raise ValueError(f"No loan with id {loan_id}")
        limit = max(1, min(limit, 10))
        with db.connect() as conn:
            calls = [dict(row) for row in conn.execute(
                "SELECT id, channel, started_at, ended_at, situation, offer, promise_amount, promise_date "
                "FROM calls WHERE loan_id = ? AND ended_at IS NOT NULL ORDER BY id DESC LIMIT ?",
                (loan_id, limit),
            ).fetchall()]
            if include_transcript:
                for call in calls:
                    turns = conn.execute(
                        "SELECT role, text FROM turns WHERE call_id = ? ORDER BY id DESC LIMIT 30", (call["id"],)
                    ).fetchall()
                    call["transcript"] = [dict(row) for row in reversed(turns)]
            earlier = conn.execute(
                "SELECT COUNT(*) AS n FROM calls WHERE loan_id = ? AND ended_at IS NOT NULL", (loan_id,)
            ).fetchone()["n"]

        # Worked out here in plain words, so the LLM never has to guess from raw rows.
        if not calls:
            summary = "There are no earlier calls with this borrower. This is the first call."
        else:
            latest = calls[0]
            plural = "is 1 earlier call" if earlier == 1 else f"are {earlier} earlier calls"
            when = latest["started_at"][:16].replace("T", " ")
            if latest["offer"] and latest["offer"] != "none":
                what = f"ended with this plan agreed: {latest['offer']}"
            else:
                what = "ended with no plan or promise recorded"
            summary = f"There {plural} with this borrower, so this is NOT the first call. The most recent one ({when}) {what}."

        return {"loan_id": loan_id, "earlier_calls": earlier, "summary": summary, "calls": calls}

    @mcp.resource("emi://calling-rules")
    def calling_rules() -> str:
        """The rules the agent must follow: calling hours, calls per day, who must not be called, and the allowed plans."""
        return "\n".join(rules.describe())
    