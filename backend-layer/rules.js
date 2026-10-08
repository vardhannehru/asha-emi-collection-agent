// Our own calling and payment rules for the demo. Change them here and nowhere else.

export const CALL_START_HOUR = 9;
export const CALL_END_HOUR = 18;
export const MAX_CALLS_PER_DAY = 2;
export const MAX_EXTENSION_DAYS = 5;
export const SPLIT_SECOND_PART_DAYS = 15;

// The only plans the agent is allowed to offer.
export const OFFERS = {
  pay_full_now: "Pay the full amount today",
  extend_due_date: `Pay the full amount within ${MAX_EXTENSION_DAYS} days`,
  split_two_parts: `Pay half today and the other half within ${SPLIT_SECOND_PART_DAYS} days`,
};

const NO_CALL_STATUSES = {
  paid: "Loan is already paid",
  promised: "Borrower already promised to pay",
  disputed: "Loan is under dispute review",
  do_not_call: "Marked as wrong number",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// India time (UTC+5:30), whatever timezone the laptop is set to.
export function nowIST() {
  const d = new Date(Date.now() + 5.5 * 3600 * 1000);
  const iso = d.toISOString().slice(0, 19) + "+05:30";
  const hour = d.getUTCHours();
  const minute = String(d.getUTCMinutes()).padStart(2, "0");
  const h12 = hour % 12 || 12;
  return {
    iso,
    date: iso.slice(0, 10),
    hour,
    pretty: `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${h12}:${minute} ${hour < 12 ? "AM" : "PM"} IST`,
  };
}

export function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function prettyDate(date) {
  const d = new Date(`${date}T00:00:00Z`);
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function daysOverdue(dueDate, today) {
  const diff = (new Date(`${today}T00:00:00Z`) - new Date(`${dueDate}T00:00:00Z`)) / 86400000;
  return Math.max(Math.round(diff), 0);
}

export function enforceCallHours() {
  return (process.env.ENFORCE_CALL_HOURS ?? "true").trim().toLowerCase() !== "false";
}

// Returns [allowed, reason].
export function canCall(status, callsToday, hour = nowIST().hour) {
  if (NO_CALL_STATUSES[status]) return [false, NO_CALL_STATUSES[status]];
  if (callsToday >= MAX_CALLS_PER_DAY) return [false, `Already called ${callsToday} times today (max ${MAX_CALLS_PER_DAY})`];
  if (enforceCallHours() && !(hour >= CALL_START_HOUR && hour < CALL_END_HOUR)) {
    return [false, `Outside calling hours (${CALL_START_HOUR} AM - ${CALL_END_HOUR - 12} PM IST). Set ENFORCE_CALL_HOURS=false in backend-layer/.env to test anytime.`];
  }
  return [true, "OK"];
}

// The server decides the amount and date. The LLM only picks which allowed plan was agreed.
export function paymentPlan(offer, amountDue, today, requestedDate = "") {
  if (offer === "pay_full_now") return { amount: amountDue, payBy: today };
  if (offer === "split_two_parts") return { amount: Math.ceil(amountDue / 2), payBy: today };
  if (offer === "extend_due_date") {
    const latest = addDays(today, MAX_EXTENSION_DAYS);
    let wanted = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : latest;
    if (wanted < today) wanted = today;
    if (wanted > latest) wanted = latest;
    return { amount: amountDue, payBy: wanted };
  }
  throw new Error(`Unknown offer: ${offer}`);
}

export function describe() {
  let hours = `Calls only between ${CALL_START_HOUR} AM and ${CALL_END_HOUR - 12} PM IST`;
  if (!enforceCallHours()) hours += " (switched off for testing)";
  return [
    hours,
    `At most ${MAX_CALLS_PER_DAY} calls per loan per day`,
    "No calls to paid, promised, disputed or wrong-number loans",
    ...Object.values(OFFERS).map((text) => `Allowed plan: ${text}`),
  ];
}