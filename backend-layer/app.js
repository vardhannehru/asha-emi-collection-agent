// Backend layer: the CRM, our rules, calls, payments, Twilio phone calls, and the live link to the AI layer.
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import express from "express";
import { db, initDb, clearHistory, timestamp } from "./db.js";
import * as rules from "./rules.js";
import { findLoan, callsToday, offersFor } from "./crm.js";
import * as twilio from "./twilio.js";
import * as whatsapp from "./whatsapp.js";
import * as auth from "./auth.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(HERE, ".env") });

const PORT = Number(process.env.BACKEND_PORT) || 5000;
const AI_LAYER_URL = (process.env.AI_LAYER_URL || "http://127.0.0.1:8001").replace(/\/$/, "");
const LENDER = process.env.LENDER_NAME || "Demo Finance";
const FRONTEND_DIST = path.join(HERE, "..", "frontend-layer", "dist");

initDb();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // Twilio posts its webhooks as form data, not JSON

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Runs a route that may be async, sends what it returns as JSON, and turns any error into a JSON message.
// fn(req, res) is called inside the .then() (not passed directly to Promise.resolve), so a plain,
// non-async handler that throws synchronously (e.g. requireAgent) is caught here too, not just async ones.
const wrap = (fn) => (req, res) => {
  Promise.resolve()
    .then(() => fn(req, res))
    .then((result) => {
      if (result !== undefined && !res.headersSent) res.json(result);
    })
    .catch((error) => {
      const status = error.status || 500;
      if (status === 500) console.error(error);
      if (!res.headersSent) res.status(status).json({ detail: error.message });
    });
};

// ------------------------------------------------------------------ helpers --
function getLoan(id) {
  const loan = findLoan(id);
  if (!loan) throw new HttpError(404, "Loan not found");
  return loan;
}

function getCall(id) {
  const call = db.prepare("SELECT * FROM calls WHERE id = ?").get(Number(id));
  if (!call) throw new HttpError(404, "Call not found");
  return call;
}

// Every borrower-facing route needs a logged-in agent. Throws 401 if there is none.
function requireAgent(req) {
  const me = auth.currentAgent(req);
  if (!me) throw new HttpError(401, "Please log in");
  return me;
}

// A loan is visible to an agent if it's assigned to them, or nobody has claimed it yet.
function visibleTo(loan, agentId) {
  return loan.assigned_agent_id === null || loan.assigned_agent_id === agentId;
}

function getLoanFor(id, agentId) {
  const loan = getLoan(id);
  if (!visibleTo(loan, agentId)) throw new HttpError(403, "This client belongs to another agent's queue");
  return loan;
}

// Stricter than getLoanFor: the loan must actually be claimed by you, not just unclaimed and visible.
// Only calling should require this - an agent may still look at, edit or claim an unclaimed loan first.
function getClaimedLoan(id, agentId) {
  const loan = getLoan(id);
  if (loan.assigned_agent_id === null) throw new HttpError(409, "Claim this client first, then call them");
  if (loan.assigned_agent_id !== agentId) throw new HttpError(403, "This client belongs to another agent's queue");
  return loan;
}

// Asks the AI layer if it is alive. Returns its /health answer, or null if it is not reachable.
async function aiHealth() {
  try {
    const response = await fetch(`${AI_LAYER_URL}/health`, { signal: AbortSignal.timeout(1500) });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

// Calls one of the AI layer's plain HTTP routes (used for phone calls: each webhook is its own request).
async function aiPost(pathPart, body) {
  const response = await fetch(`${AI_LAYER_URL}${pathPart}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(14000),
  });
  if (!response.ok) throw new Error(`AI layer ${pathPart} -> ${response.status}`);
  return response.json();
}

// What the dashboard shows after a call: the loan's new status, any payment link, and the WhatsApp message sent.
function summary(call) {
  const loan = getLoan(call.loan_id);
  const payment = db.prepare("SELECT url FROM payments WHERE loan_id = ? AND created_at >= ? ORDER BY id DESC LIMIT 1")
    .get(loan.id, call.started_at);
  const message = db.prepare("SELECT text, status, error, to_number FROM whatsapp_messages WHERE loan_id = ? AND created_at >= ? ORDER BY id DESC LIMIT 1")
    .get(loan.id, call.started_at);
  return { loan_status: loan.status, payment_url: payment ? payment.url : null, whatsapp: message || null };
}

function createPayment(loan, amount) {
  const { lastInsertRowid } = db.prepare("INSERT INTO payments (loan_id, url, amount, created_at) VALUES (?, '', ?, ?)")
    .run(loan.id, amount, timestamp());
  const base = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
  const url = `${base}/pay?id=${lastInsertRowid}`;
  db.prepare("UPDATE payments SET url = ? WHERE id = ?").run(url, lastInsertRowid);
  return url;
}

function saveTurn(callId, role, text) {
  if (!text) return;
  db.prepare("INSERT INTO turns (call_id, role, text, created_at) VALUES (?, ?, ?, ?)").run(callId, role, text, timestamp());
}

// Records what the LLM decided (from record_outcome). finishCall (below) reads these columns.
function applyOutcome(callId, outcome) {
  if (!outcome) return;
  db.prepare("UPDATE calls SET situation = ?, offer = ?, promise_date = ? WHERE id = ?")
    .run(outcome.situation, outcome.offer, outcome.promise_date || null, callId);
}

// Safe to call twice: the first call sets ended_at, so a second call does nothing new.
async function finishCall(callId) {
  const call = getCall(callId);
  if (call.ended_at) return summary(call);
  db.prepare("UPDATE calls SET ended_at = ? WHERE id = ?").run(timestamp(), call.id);

  const loan = getLoan(call.loan_id);
  let status = loan.status;
  if (call.situation === "wrong_number") {
    status = "do_not_call";
  } else if (call.situation === "dispute") {
    status = "disputed";
    await whatsapp.send(loan.id, whatsapp.disputeText(loan.name, LENDER));
  } else if (rules.OFFERS[call.offer]) {
    // The server decides the amount and date. The LLM only picks which allowed plan was agreed.
    const { amount, payBy } = rules.paymentPlan(call.offer, loan.amount_due, rules.nowIST().date, call.promise_date || "");
    db.prepare("UPDATE calls SET promise_amount = ?, promise_date = ? WHERE id = ?").run(amount, payBy, call.id);
    status = "promised";
    const url = createPayment(loan, amount);
    await whatsapp.send(loan.id, whatsapp.paymentText(loan.name, amount, payBy, url, LENDER));
  }
  db.prepare("UPDATE loans SET status = ? WHERE id = ?").run(status, loan.id);
  console.log(`[call ${call.id}] finished: ${loan.name} -> ${status}`);
  return summary(getCall(call.id));
}

async function markPaid(paymentId) {
  const payment = db.prepare("SELECT * FROM payments WHERE id = ?").get(Number(paymentId));
  if (!payment || payment.status === "paid") return;
  db.prepare("UPDATE payments SET status = 'paid' WHERE id = ?").run(payment.id);
  const loan = getLoan(payment.loan_id);
  const remaining = Math.max(loan.amount_due - payment.amount, 0);
  db.prepare("UPDATE loans SET amount_due = ?, status = ? WHERE id = ?").run(remaining, remaining === 0 ? "paid" : "part_paid", loan.id);
  await whatsapp.send(loan.id, whatsapp.receiptText(loan.name, payment.amount, remaining, LENDER));
}

// What the AI layer needs at the start of a call: the loan, the exact plans, and the ids.
function callContext(call) {
  const loan = getLoan(call.loan_id);
  const today = rules.nowIST().date;
  return {
    event: "emi_context",
    type: "emi_context",
    call_id: call.id,
    loan_id: loan.id,
    lender: LENDER,
    today,
    offers: offersFor(loan, today),
    loan: { name: loan.name, amount_due: loan.amount_due, due_date: loan.due_date, days_overdue: rules.daysOverdue(loan.due_date, today) },
  };
}

// -------------------------------------------------------------------- agents --
app.post("/api/auth/register", wrap((req, res) => {
  const name = String(req.body.name || "").trim();
  const username = String(req.body.username || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (!name) throw new HttpError(400, "Enter your name");
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) throw new HttpError(400, "Username: 3-30 letters, numbers, dots, dashes or underscores");
  if (password.length < 6) throw new HttpError(400, "Password must be at least 6 characters");
  const created = auth.createAgent(name, username, password);
  const token = auth.createSession(created.id);
  auth.setSessionCookie(res, token);
  return { id: created.id, name: created.name };
}));

app.post("/api/auth/login", wrap((req, res) => {
  const username = String(req.body.username || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const found = auth.findAgentByUsername(username);
  if (!found || !auth.verifyPassword(password, found.password_hash)) throw new HttpError(401, "Wrong username or password");
  const token = auth.createSession(found.id);
  auth.setSessionCookie(res, token);
  return { id: found.id, name: found.name };
}));

app.post("/api/auth/logout", wrap((req, res) => {
  auth.endSession(auth.sessionToken(req));
  auth.clearSessionCookie(res);
  return { ok: true };
}));

app.get("/api/auth/me", wrap((req) => {
  const me = auth.currentAgent(req);
  if (!me) throw new HttpError(401, "Not logged in");
  return { id: me.id, name: me.name };
}));

// ---------------------------------------------------------------- dashboard --
app.get("/api/status", wrap(async () => {
  const ai = await aiHealth();
  return {
    ai_layer: Boolean(ai),
    agent: ai ? ai.brain : "AI layer offline (start ai-layer)",
    payments: "Mock payment page",
    phone_calls: twilio.twilioEnabled(),
    phone_mode: twilio.phoneMode(),
    whatsapp: whatsapp.whatsappEnabled(),
    enforce_call_hours: rules.enforceCallHours(),
    rules: rules.describe(),
    offers: rules.OFFERS,
    lender: LENDER,
    now_ist: rules.nowIST().pretty,
  };
}));

// Only shows loans assigned to you, plus anything nobody has claimed yet (the shared pool).
app.get("/api/loans", wrap((req) => {
  const me = requireAgent(req);
  const today = rules.nowIST().date;
  const phoneOn = twilio.twilioEnabled();
  const loans = db.prepare("SELECT * FROM loans WHERE assigned_agent_id = ? OR assigned_agent_id IS NULL ORDER BY due_date").all(me.id).map((loan) => {
    const count = callsToday(loan.id);
    const [ok, reason] = rules.canCall(loan.status, count);
    return {
      ...loan,
      days_overdue: rules.daysOverdue(loan.due_date, today),
      calls_today: count,
      can_call: ok,
      blocked_reason: ok ? null : reason,
      dial_to: phoneOn ? twilio.dialNumber(loan.phone) : null,
      dial_is_own: phoneOn && twilio.allowedNumbers().has(twilio.normalize(loan.phone)),
      assigned_to_me: loan.assigned_agent_id === me.id,
      unassigned: loan.assigned_agent_id === null,
      last_call: db.prepare("SELECT situation, offer, promise_amount, promise_date FROM calls WHERE loan_id = ? ORDER BY id DESC LIMIT 1").get(loan.id) || null,
      payment: db.prepare("SELECT id, url, amount, status FROM payments WHERE loan_id = ? ORDER BY id DESC LIMIT 1").get(loan.id) || null,
    };
  });
  return loans;
}));

// Only ever picks from loans you've actually claimed - it starts a call right away, so it can't use
// the unclaimed pool (calling now requires a claim first).
app.post("/api/scheduler/next", wrap((req) => {
  const me = requireAgent(req);
  const loans = db.prepare("SELECT * FROM loans WHERE assigned_agent_id = ? ORDER BY due_date").all(me.id).map((loan) => {
    const [ok, reason] = rules.canCall(loan.status, callsToday(loan.id));
    return { id: loan.id, name: loan.name, can_call: ok, blocked_reason: ok ? null : reason };
  });
  const skip = new Set(Array.isArray(req.body?.skip) ? req.body.skip.map(Number) : []);
  const next = loans.find((loan) => loan.can_call && !skip.has(loan.id));
  if (next) return { loan_id: next.id, name: next.name };
  if (!loans.length) return { loan_id: null, reason: "You haven't claimed any clients yet. Claim one from My Loans first." };
  const reasons = [...new Set(loans.map((loan) => loan.blocked_reason))].sort().join(" / ");
  return { loan_id: null, reason: `No loan can be called right now. ${reasons}` };
}));

// Clears call/payment/message history and makes every loan callable again. Never touches the loans
// themselves, so anything you added or edited (names, phone numbers, new borrowers) is kept.
app.post("/api/reset", wrap((req) => {
  requireAgent(req);
  clearHistory();
  return { ok: true };
}));

// Takes an unclaimed client into your own queue.
app.post("/api/loans/:id/claim", wrap((req) => {
  const me = requireAgent(req);
  const loan = getLoan(req.params.id);
  if (loan.assigned_agent_id !== null && loan.assigned_agent_id !== me.id) {
    throw new HttpError(409, "This client is already assigned to another agent");
  }
  db.prepare("UPDATE loans SET assigned_agent_id = ? WHERE id = ? AND assigned_agent_id IS NULL").run(me.id, loan.id);
  return { ok: true };
}));

// Puts one of your clients back in the shared pool for another agent to pick up.
app.post("/api/loans/:id/release", wrap((req) => {
  const me = requireAgent(req);
  const loan = getLoanFor(req.params.id, me.id);
  db.prepare("UPDATE loans SET assigned_agent_id = NULL WHERE id = ?").run(loan.id);
  return { ok: true };
}));

app.post("/api/loans/:id/phone", wrap((req) => {
  const me = requireAgent(req);
  const digits = String(req.body.phone || "").replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) throw new HttpError(400, "Enter a full phone number with country code, e.g. +91 followed by the 10-digit number");
  const loan = getLoanFor(req.params.id, me.id);
  db.prepare("UPDATE loans SET phone = ? WHERE id = ?").run(`+${digits}`, loan.id);
  return { ok: true };
}));

// Adds a new borrower/loan. phone is optional here; set it with /api/loans/:id/phone if it's missing.
app.post("/api/loans", wrap((req) => {
  const name = String(req.body.name || "").trim();
  const amount = Number(req.body.amount_due);
  const dueDate = String(req.body.due_date || "").trim();
  const digits = String(req.body.phone || "").replace(/\D/g, "");
  if (!name) throw new HttpError(400, "Enter the borrower's name");
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, "Enter a whole number amount greater than 0");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new HttpError(400, "Enter the due date as YYYY-MM-DD");
  if (digits && (digits.length < 10 || digits.length > 15)) throw new HttpError(400, "Enter a full phone number with country code, e.g. +91 followed by the 10-digit number");
  // A new client you bring in is yours, not up for grabs by other agents.
  const me = requireAgent(req);
  const { lastInsertRowid } = db.prepare("INSERT INTO loans (name, phone, amount_due, due_date, assigned_agent_id) VALUES (?, ?, ?, ?, ?)")
    .run(name, digits ? `+${digits}` : "+910000000000", Math.round(amount), dueDate, me.id);
  return { id: lastInsertRowid };
}));

// Edits an existing loan's name, amount or due date. Use /api/loans/:id/phone for the phone number.
app.post("/api/loans/:id", wrap((req) => {
  const me = requireAgent(req);
  const loan = getLoanFor(req.params.id, me.id);
  const name = req.body.name === undefined ? loan.name : String(req.body.name).trim();
  const amount = req.body.amount_due === undefined ? loan.amount_due : Number(req.body.amount_due);
  const dueDate = req.body.due_date === undefined ? loan.due_date : String(req.body.due_date).trim();
  if (!name) throw new HttpError(400, "Enter the borrower's name");
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, "Enter a whole number amount greater than 0");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new HttpError(400, "Enter the due date as YYYY-MM-DD");
  db.prepare("UPDATE loans SET name = ?, amount_due = ?, due_date = ? WHERE id = ?").run(name, Math.round(amount), dueDate, loan.id);
  return { ok: true };
}));

// Removes a loan and everything recorded against it (calls, turns, payments, WhatsApp messages).
app.post("/api/loans/:id/delete", wrap((req) => {
  const me = requireAgent(req);
  const loan = getLoanFor(req.params.id, me.id);
  const callIds = db.prepare("SELECT id FROM calls WHERE loan_id = ?").all(loan.id).map((c) => c.id);
  for (const callId of callIds) db.prepare("DELETE FROM turns WHERE call_id = ?").run(callId);
  db.prepare("DELETE FROM calls WHERE loan_id = ?").run(loan.id);
  db.prepare("DELETE FROM payments WHERE loan_id = ?").run(loan.id);
  db.prepare("DELETE FROM whatsapp_messages WHERE loan_id = ?").run(loan.id);
  db.prepare("DELETE FROM loans WHERE id = ?").run(loan.id);
  return { ok: true };
}));

// Everything about one borrower in one go: details, every call with its transcript, payments and WhatsApp messages.
app.get("/api/loans/:id/profile", wrap((req) => {
  const me = requireAgent(req);
  const loan = getLoanFor(req.params.id, me.id);
  const turnsOf = db.prepare("SELECT role, text, created_at FROM turns WHERE call_id = ? ORDER BY id");
  return {
    loan: {
      ...loan,
      days_overdue: rules.daysOverdue(loan.due_date, rules.nowIST().date),
      calls_today: callsToday(loan.id),
      assigned_to_me: loan.assigned_agent_id === me.id,
      unassigned: loan.assigned_agent_id === null,
    },
    calls: db.prepare("SELECT id, channel, started_at, ended_at, situation, offer, promise_amount, promise_date FROM calls WHERE loan_id = ? ORDER BY id DESC")
      .all(loan.id).map((call) => ({ ...call, turns: turnsOf.all(call.id) })),
    payments: db.prepare("SELECT id, url, amount, status, created_at FROM payments WHERE loan_id = ? ORDER BY id DESC").all(loan.id),
    messages: db.prepare("SELECT id, text, to_number, status, error, created_at FROM whatsapp_messages WHERE loan_id = ? ORDER BY id DESC").all(loan.id),
  };
}));

// -------------------------------------------------------------------- calls --
app.post("/api/calls", wrap(async (req) => {
  const me = requireAgent(req);
  const loan = getClaimedLoan(req.body.loan_id, me.id); // must already be claimed by you - no auto-claim on call
  const channel = req.body.channel === "phone" ? "phone" : "browser";
  const [ok, reason] = rules.canCall(loan.status, callsToday(loan.id));
  if (!ok) throw new HttpError(409, reason);
  if (!(await aiHealth())) throw new HttpError(503, "The AI layer is not running. Start it first (ai-layer: python app.py).");
  if (channel === "phone" && !twilio.twilioEnabled()) {
    throw new HttpError(400, "Phone calls need TWILIO_*, DEMO_PHONE_NUMBER and PUBLIC_BASE_URL in backend-layer/.env");
  }

  const { lastInsertRowid: callId } = db.prepare("INSERT INTO calls (loan_id, channel, started_at) VALUES (?, ?, ?)")
    .run(loan.id, channel, timestamp());
  if (channel === "phone") {
    try {
      const sid = await twilio.startCall(callId, twilio.dialNumber(loan.phone));
      db.prepare("UPDATE calls SET twilio_sid = ? WHERE id = ?").run(sid, callId);
    } catch (error) {
      db.prepare("DELETE FROM calls WHERE id = ?").run(callId);
      throw new HttpError(502, error.message);
    }
  }
  return { call_id: callId, channel };
}));

// Every call on the borrowers you can see, newest first (for the Calls page).
app.get("/api/calls", wrap((req) => {
  const me = requireAgent(req);
  return db.prepare(
    "SELECT c.id, c.loan_id, l.name, c.channel, c.started_at, c.ended_at, c.situation, c.offer, c.promise_amount, c.promise_date, " +
    "(SELECT COUNT(*) FROM turns t WHERE t.call_id = c.id) AS turns " +
    "FROM calls c JOIN loans l ON l.id = c.loan_id WHERE l.assigned_agent_id = ? OR l.assigned_agent_id IS NULL ORDER BY c.id DESC LIMIT 200",
  ).all(me.id);
}));

app.get("/api/calls/:id", wrap((req) => {
  const me = requireAgent(req);
  const call = getCall(req.params.id);
  const loan = getLoanFor(call.loan_id, me.id);
  return {
    call,
    loan,
    turns: db.prepare("SELECT role, text, created_at FROM turns WHERE call_id = ? ORDER BY id").all(call.id),
    summary: call.ended_at ? summary(call) : null,
  };
}));

app.post("/api/calls/:id/end", wrap(async (req) => {
  const me = requireAgent(req);
  const call = getCall(req.params.id);
  getLoanFor(call.loan_id, me.id);
  if (call.channel === "phone" && call.twilio_sid && !call.ended_at) {
    // Fast path only: Twilio's API often refuses (404) on trial accounts. The next webhook hangs up anyway.
    twilio.hangUp(call.twilio_sid).catch((error) => console.error("[twilio] hang up failed:", error.message));
  }
  return finishCall(call.id);
}));

app.get("/api/whatsapp", wrap((req) => {
  const me = requireAgent(req);
  return db.prepare(
    "SELECT w.id, w.loan_id, w.text, w.status, w.error, w.to_number, w.created_at, l.name FROM whatsapp_messages w " +
    "JOIN loans l ON l.id = w.loan_id WHERE l.assigned_agent_id = ? OR l.assigned_agent_id IS NULL ORDER BY w.id DESC LIMIT 100",
  ).all(me.id);
}));

app.post("/api/whatsapp/:id/resend", wrap(async (req) => {
  const me = requireAgent(req);
  const msg = db.prepare(
    "SELECT w.id, w.text, w.to_number, w.loan_id, l.assigned_agent_id FROM whatsapp_messages w " +
    "JOIN loans l ON l.id = w.loan_id WHERE w.id = ?",
  ).get(Number(req.params.id));
  if (!msg) throw new HttpError(404, "Message not found");
  if (msg.assigned_agent_id !== me.id && msg.assigned_agent_id !== null) throw new HttpError(403, "Not your message");

  await whatsapp.send(msg.loan_id, msg.text);
  return { status: "sent" };
}));

// ----------------------------------------------------------------- payments --
// Every payment link on the borrowers you can see, newest first (for the Payments page).
app.get("/api/payments", wrap((req) => {
  const me = requireAgent(req);
  return db.prepare(
    "SELECT p.id, p.loan_id, l.name, p.url, p.amount, p.status, p.created_at FROM payments p " +
    "JOIN loans l ON l.id = p.loan_id WHERE l.assigned_agent_id = ? OR l.assigned_agent_id IS NULL ORDER BY p.id DESC LIMIT 200",
  ).all(me.id);
}));

app.get("/api/payments/:id", wrap((req) => {
  const payment = db.prepare("SELECT p.id, p.amount, p.status, l.name FROM payments p JOIN loans l ON l.id = p.loan_id WHERE p.id = ?")
    .get(Number(req.params.id));
  if (!payment) throw new HttpError(404, "Payment not found");
  return payment;
}));

// Stands in for a real payment gateway: pressing "pay" on the test page calls this.
app.post("/api/payments/:id/mock-pay", wrap(async (req) => {
  if (!db.prepare("SELECT id FROM payments WHERE id = ?").get(Number(req.params.id))) throw new HttpError(404, "Payment not found");
  await markPaid(req.params.id);
  return { status: "paid" };
}));

// ------------------------------------------------------------------- the web page --
// Serves the built React app (run `npm run build` in frontend-layer after any frontend change), so the
// payment links this backend creates (PUBLIC_BASE_URL/pay?id=...) actually resolve to a real page.
app.use(express.static(FRONTEND_DIST, { setHeaders: (res) => res.setHeader("Cache-Control", "no-cache") }));
app.get(["/", "/call", "/pay"], (req, res) => {
  const index = path.join(FRONTEND_DIST, "index.html");
  if (fs.existsSync(index)) return res.sendFile(index);
  res.status(503).send("Frontend not built yet. Run: cd frontend-layer && npm run build (or npm run dev for http://localhost:3001).");
});

// ---------------------------------------------------------- Twilio webhooks --
function twilioRequestOk(req) {
  return twilio.validSignature(twilio.publicUrl(req.originalUrl), req.body || {}, req.get("X-Twilio-Signature"));
}

// Answers a Twilio webhook with TwiML built by `build`. Any failure plays a polite goodbye instead of silence.
const twiml = (build) => (req, res) => {
  if (!twilioRequestOk(req)) return res.status(403).send("Invalid Twilio signature");
  Promise.resolve(build(Number(req.params.id), req.body))
    .then((xml) => res.type("text/xml").send(xml))
    .catch((error) => {
      console.error("[twilio webhook]", error);
      res.type("text/xml").send(twilio.troubleTwiml());
    });
};

app.post("/twilio/voice/:id", twiml(async (callId) => {
  const call = getCall(callId);
  const loan = getLoan(call.loan_id);
  const { text } = await aiPost("/gather/start", callContext(call));
  saveTurn(call.id, "agent", text);
  return twilio.listenTwiml(call.id, text, loan.name);
}));

app.post("/twilio/gather/:id", twiml(async (callId, body) => {
  const call = getCall(callId);
  if (call.ended_at) return twilio.hangupTwiml("Goodbye.");
  const loan = getLoan(call.loan_id);
  const heard = (body.SpeechResult || "").trim();
  if (!heard) return twilio.listenTwiml(call.id, "Sorry, I didn't catch that. Could you say that again?", loan.name);

  saveTurn(call.id, "borrower", heard);
  const { text, ended, outcome } = await aiPost("/gather/reply", { call_id: call.id, text: heard });
  saveTurn(call.id, "agent", text);
  if (!ended) return twilio.listenTwiml(call.id, text, loan.name);

  applyOutcome(call.id, outcome);
  await aiPost("/gather/end", { call_id: call.id });
  await finishCall(call.id);
  return twilio.hangupTwiml(text);
}));

app.post("/twilio/status/:id", (req, res) => {
  if (!twilioRequestOk(req)) return res.status(403).send("Invalid Twilio signature");
  if (["completed", "busy", "no-answer", "failed", "canceled"].includes(req.body.CallStatus)) {
    aiPost("/gather/end", { call_id: Number(req.params.id) }).catch(() => {});
    finishCall(req.params.id).catch((error) => console.error("[twilio] finish failed:", error.message));
  }
  res.status(204).end();
});

const server = http.createServer(app);

server.listen(PORT, () => {
  console.log(`Backend layer on http://localhost:${PORT}`);
  console.log(`  AI layer: ${AI_LAYER_URL}`);
  console.log(`  Phone calls: ${twilio.twilioEnabled() ? "on" : "off"}`);
});
