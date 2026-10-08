// WhatsApp through Meta's WhatsApp Cloud API. Every message is saved for the dashboard. It is really sent only when
// the WHATSAPP_* values are set. It goes to the loan's own number if that number is allowed on the Meta test number
// (DEMO_WHATSAPP_NUMBER plus WHATSAPP_ALLOWED_NUMBERS), else to the phone that was called if allowed, else to
// DEMO_WHATSAPP_NUMBER. Never to made-up numbers.
import { db, timestamp } from "./db.js";
import { prettyDate } from "./rules.js";
import { dialNumber, normalize, twilioEnabled } from "./twilio.js";

const REQUIRED = ["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "DEMO_WHATSAPP_NUMBER"];

const ERROR_HINTS = {
  190: "Access token expired or wrong. Generate a new one in the Meta developer dashboard.",
  131030: "This number isn't in your test number's allowed list. Add it under WhatsApp > API Setup > To.",
  131047: "More than 24 hours since this phone messaged your test number. Send 'hi' to it first.",
};

export const whatsappEnabled = () => REQUIRED.every((name) => process.env[name]);

export function allowedNumbers() {
  const listed = [process.env.DEMO_WHATSAPP_NUMBER || "", ...(process.env.WHATSAPP_ALLOWED_NUMBERS || "").split(",")];
  return new Set(listed.filter((n) => /\d/.test(n)).map(normalize));
}

function recipientFor(loanId) {
  const loan = db.prepare("SELECT phone FROM loans WHERE id = ?").get(loanId);
  const allowed = allowedNumbers();
  const own = loan ? normalize(loan.phone) : "";
  if (allowed.has(own)) return own;
  const called = loan && twilioEnabled() ? dialNumber(loan.phone) : own;
  return allowed.has(called) ? called : normalize(process.env.DEMO_WHATSAPP_NUMBER);
}

async function deliver(to, text) {
  const version = process.env.WHATSAPP_API_VERSION || "v23.0";
  try {
    const response = await fetch(`https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to.replace(/\D/g, ""),
        type: "text",
        text: { body: text, preview_url: true },
      }),
    });
    if (response.ok) return ["sent", null];
    const error = (await response.json().catch(() => ({}))).error || {};
    const detail = ERROR_HINTS[error.code] || error.message || `HTTP ${response.status}`;
    return ["failed", `${detail} (WhatsApp error ${error.code || response.status})`];
  } catch (error) {
    return ["failed", `Could not reach WhatsApp: ${error.message}`];
  }
}

export async function sendTo(to, text) {
  return deliver(to, text);
}

export async function send(loanId, text) {
  let toNumber = null;
  let status = "not_sent";
  let error = null;
  if (whatsappEnabled()) {
    toNumber = recipientFor(loanId);
    [status, error] = await deliver(toNumber, text);
  }
  db.prepare("INSERT INTO whatsapp_messages (loan_id, text, to_number, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(loanId, text, toNumber, status, error, timestamp());
}

const firstName = (name) => name.split(" ")[0];
const rupees = (n) => `₹${Number(n).toLocaleString("en-IN")}`;

export const paymentText = (name, amount, payBy, url, lender) =>
  `Hi ${firstName(name)}, thanks for speaking with us today. As agreed, please pay ${rupees(amount)} by ${prettyDate(payBy)}.\n\nClick the link below:\n${url}\n- ${lender}`;

export const disputeText = (name, lender) =>
  `Hi ${firstName(name)}, we've noted your concern about your loan. Our team will review it and get back to you within 2 working days. We won't call you about this EMI until then.\n- ${lender}`;

export const receiptText = (name, amount, remaining, lender) =>
  `Hi ${firstName(name)}, we've received your payment of ${rupees(amount)}. Thank you!` +
  (remaining ? ` Remaining balance: ${rupees(remaining)}.` : " Your EMI is now fully paid.") + `\n- ${lender}`;
