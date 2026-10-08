// Real phone calls through Twilio. Twilio's own <Gather> listens (speech to text) and <Say> speaks Asha's
// words in Twilio's built-in voice, so this works on a trial account with no Deepgram or ElevenLabs yet.
// A loan's own number is dialled only if it is in the allowlist (DEMO_PHONE_NUMBER plus
// TWILIO_VERIFIED_NUMBERS); any other number falls back to DEMO_PHONE_NUMBER.
import crypto from "node:crypto";

const REQUIRED = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER", "DEMO_PHONE_NUMBER", "PUBLIC_BASE_URL"];

export const twilioEnabled = () => REQUIRED.every((name) => process.env[name]);

export const normalize = (number) => "+" + String(number || "").replace(/\D/g, "");

export function allowedNumbers() {
  const listed = [...(process.env.TWILIO_VERIFIED_NUMBERS || "").split(","), process.env.DEMO_PHONE_NUMBER || ""];
  return new Set(listed.filter((n) => /\d/.test(n)).map(normalize));
}

export function dialNumber(loanPhone) {
  const wanted = normalize(loanPhone);
  return allowedNumbers().has(wanted) ? wanted : normalize(process.env.DEMO_PHONE_NUMBER);
}

// Twilio trial accounts tie each verified recipient to one assigned number: "recipient=twilio_number,...".
export function fromNumber(to) {
  for (const pair of (process.env.TWILIO_FROM_NUMBERS || "").split(",")) {
    const [recipient, sender] = pair.split("=");
    if (sender && sender.trim() && normalize(recipient) === normalize(to)) return normalize(sender);
  }
  return process.env.TWILIO_PHONE_NUMBER;
}

export const publicUrl = (p) => process.env.PUBLIC_BASE_URL.replace(/\/$/, "") + p;

// This project only supports listen-and-reply (Twilio's own voice + speech-to-text), never live audio streaming.
export const phoneMode = () => "gather";

async function twilioApi(pathPart, form) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}${pathPart}`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Twilio error ${response.status}: ${body.message || JSON.stringify(body)}`);
  return body;
}

export async function startCall(callId, to) {
  const body = await twilioApi("/Calls.json", {
    To: to,
    From: fromNumber(to),
    Url: publicUrl(`/twilio/voice/${callId}`),
    StatusCallback: publicUrl(`/twilio/status/${callId}`),
  });
  return body.sid;
}

// Twilio answers 404 while a call is still connecting (trial announcement), so retry for a few seconds.
export async function hangUp(callSid) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await twilioApi(`/Calls/${callSid}.json`, { Status: "completed" });
    } catch (error) {
      if (attempt >= 6 || !error.message.includes("404")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

const xml = (inner) => `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;
const escapeXml = (s) => String(s).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);
const say = (text) => `<Say voice="Polly.Aditi" language="en-IN">${escapeXml(text)}</Say>`;

// Says the text, then listens for the borrower's reply. actionOnEmptyResult makes Twilio call our webhook
// even if it heard nothing; the trailing <Redirect> is a safety net in case that setting is ignored.
export function listenTwiml(callId, text, hints = "") {
  const action = publicUrl(`/twilio/gather/${callId}`);
  return xml(
    `<Gather input="speech" action="${action}" method="POST" speechTimeout="auto" language="en-IN" ` +
      `hints="${escapeXml(hints)}" actionOnEmptyResult="true">${say(text)}</Gather>` +
      `<Redirect method="POST">${action}</Redirect>`,
  );
}

export const hangupTwiml = (text) => xml(`${say(text)}<Hangup/>`);

export const troubleTwiml = () =>
  xml(`${say("Sorry, we are having a technical problem. We will call you back later. Goodbye.")}<Hangup/>`);

// Some trial accounts / tunnels don't send the signature header at all; it is only enforced when present.
export function validSignature(url, params, signature) {
  if (!signature) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const expected = crypto.createHmac("sha1", process.env.TWILIO_AUTH_TOKEN).update(data).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
