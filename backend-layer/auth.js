// Agent accounts and sessions. Passwords are hashed with scrypt (built into Node, no extra package).
// Sessions are a token in an httpOnly cookie, kept in memory here - they reset if the backend restarts,
// which is fine for a demo but means everyone has to log in again after a restart.
import crypto from "node:crypto";
import { db, timestamp } from "./db.js";

const SESSION_COOKIE = "emi_session";
const sessions = new Map(); // token -> agentId

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(":");
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(hash), b = Buffer.from(check);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createAgent(name, username, password) {
  const exists = db.prepare("SELECT id FROM agents WHERE username = ?").get(username);
  if (exists) throw Object.assign(new Error("That username is already taken"), { status: 409 });
  const { lastInsertRowid } = db.prepare("INSERT INTO agents (name, username, password_hash, created_at) VALUES (?, ?, ?, ?)")
    .run(name, username, hashPassword(password), timestamp());
  return { id: lastInsertRowid, name };
}

export function findAgentByUsername(username) {
  return db.prepare("SELECT * FROM agents WHERE username = ?").get(username);
}

export function createSession(agentId) {
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, agentId);
  return token;
}

export function endSession(token) {
  sessions.delete(token);
}

function cookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// The logged-in agent's row, or null. Used where being logged out is fine (e.g. the /pay page's API calls).
export function currentAgent(req) {
  const token = cookies(req)[SESSION_COOKIE];
  const agentId = token && sessions.get(token);
  if (!agentId) return null;
  return db.prepare("SELECT id, name, username FROM agents WHERE id = ?").get(agentId) || null;
}

export function setSessionCookie(res, token) {
  // 30 days, httpOnly (no JS access), lax (works with the same-site fetch calls this app makes).
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}`);
}

export function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export function sessionToken(req) {
  return cookies(req)[SESSION_COOKIE];
}
