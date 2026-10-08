# Asha: EMI Collection Voice Agent

Asha is a voice AI agent that phones borrowers whose EMI payment is overdue, offers one of three approved payment plans, and sends a WhatsApp payment link. A CRM website lets a collections team claim borrowers, start calls, and read every transcript.

Built by a team of four: Vardhan, Prashanth, Karthik and Bindu.

## What it does

1. An agent claims borrowers in the CRM and presses **Call** (or **Automate calls** to work through a queue).
2. The backend checks the rules, then Twilio dials the borrower.
3. Asha talks, turn by turn. She checks she has the right person, finds out why the payment is late, and offers a plan.
4. When the borrower agrees, the call ends with a structured result (situation, plan, promise date).
5. A payment link is sent on WhatsApp. The CRM shows the transcript, outcome and payment.
6. Disputes ("I already paid") and wrong numbers are not argued with. They are recorded and handed to a person.

The three plans: pay in full today, pay in full within 5 days, or pay half today and half within 15 days. Asha cannot offer anything else.

## Architecture

```
Borrower phone <-> Twilio (speech-to-text, text-to-speech)
                      |  webhook (through a tunnel such as ngrok)
                      v
 CRM website (React) --> Backend (Node + Express, :5001)      rules, database, Twilio, WhatsApp
                                   |
                                   v
                      AI layer (Python FastAPI, :8001)        the agent harness around the LLM
                                   |                  \
                                   v                   v
                              LLM API          MCP server (:5101)   read-only lookups
                                                        |
                                                     SQLite
```

| Folder | What it is |
|---|---|
| `frontend-layer` | The CRM: React, Vite, TypeScript |
| `backend-layer` | The gateway: Node, Express, SQLite. Enforces policy, talks to Twilio and WhatsApp |
| `ai-layer` | The agent harness: system prompt, conversation loop, tool calling, output validation |
| `mcp-server` | A read-only MCP server (loan, payment options, call history) with bearer-token auth |

## How the AI part works

- **Agent harness.** The AI layer wraps the LLM with a system prompt, the conversation history, tool calling, a limit on lookups, and validation of the final answer.
- **Grounding with MCP.** Instead of pasting loan data into the prompt, the LLM asks the MCP server for exact facts (`get_loan`, `get_payment_options`, `get_call_history`). The tools are read-only, and the `loan_id` is set by our code, so the LLM can only look up the borrower on the current call.
- **Structured output.** Each call ends with a `record_outcome` tool call. Our code checks it against allowed values and falls back to safe defaults.
- **Guardrails in code, not only in the prompt.** Calling hours, a two-calls-a-day cap, do-not-call statuses and one-owner-per-borrower are enforced in the backend. Payment amounts and dates are computed by our rules, not by the LLM.
- **Human in the loop.** Disputes and wrong numbers are escalated, not argued.
- **Turn-based voice.** Twilio listens and speaks. This is a listen-and-reply loop, not live audio streaming.
- **No RAG, on purpose.** The data is exact, structured loan data, so lookups by id are better than similarity search.

## Tech stack

React, Vite, TypeScript, Node.js, Express, SQLite, Python, FastAPI, Model Context Protocol (MCP), an Anthropic LLM (Haiku by default), Twilio Voice, WhatsApp Cloud API, ngrok.

## Run it locally

You need Node 20+, Python 3.12+, and an Anthropic API key. Twilio and WhatsApp are optional: without them the app runs with phone calls and WhatsApp off.

1. **Create your env files** by copying each example and filling it in:
   - `backend-layer/.env.example` to `backend-layer/.env`
   - `ai-layer/.env.example` to `ai-layer/.env`
   - `mcp-server/.env.example` to `mcp-server/.env`

   `MCP_TOKEN` must be the same long random string in `ai-layer/.env` and `mcp-server/.env`. Make one with:
   ```bash
   python -c "import secrets; print(secrets.token_urlsafe(32))"
   ```
2. **Install and start each part** (four terminals):
   ```bash
   cd mcp-server && pip install -r requirements.txt && python server.py
   cd ai-layer && pip install -r requirements.txt && python app.py
   cd backend-layer && npm install && npm start
   cd frontend-layer && npm install && npm run build
   ```
3. Open **http://localhost:5001** and register an account. For frontend development, run `npm run dev` in `frontend-layer` and open http://localhost:3001.
4. **Test the agent without a phone:** `cd ai-layer && python chat.py` lets you type as the borrower.

For real phone calls you also need a Twilio account (a trial account works for verified numbers) and a public tunnel, for example `ngrok http 5001`. Put the tunnel address in `PUBLIC_BASE_URL`.

Optional: `frontend-layer/.env.local.example` shows how to enable a Shift+R developer-login shortcut.

## Honest limits

- Built and tested on a Twilio trial account and Meta's WhatsApp test number, so only verified and allowed numbers work.
- Payments are a mock page, not a real gateway.
- Testing so far is manual (a terminal test script, Postman, and real calls). There is no automated evaluation suite yet, so no accuracy numbers are claimed.
- No savings or cost figures have been measured. That would need a pilot on real accounts.
- This is a demo, not a production system. Sessions are kept in memory, there is no rate limiting, and sign-up is open. Do not expose it to the internet as it is.

## Next steps

An automated evaluation harness with scripted borrower scenarios, a real payment gateway, a link to a lender's own loan system, automatic retries, and reporting.
