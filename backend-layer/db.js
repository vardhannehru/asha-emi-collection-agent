// SQLite (built into Node): loans, calls, what was said, payments and WhatsApp messages.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { addDays, nowIST } from "./rules.js";

const DB_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "loans.db");

export const db = new DatabaseSync(DB_PATH);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS agents (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS loans (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  amount_due INTEGER NOT NULL,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'due',
  assigned_agent_id INTEGER REFERENCES agents(id)
);
CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY,
  loan_id INTEGER NOT NULL REFERENCES loans(id),
  channel TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  situation TEXT,
  offer TEXT,
  promise_amount INTEGER,
  promise_date TEXT,
  twilio_sid TEXT
);
CREATE TABLE IF NOT EXISTS turns (
  id INTEGER PRIMARY KEY,
  call_id INTEGER NOT NULL REFERENCES calls(id),
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  loan_id INTEGER NOT NULL REFERENCES loans(id),
  url TEXT NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'created',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id INTEGER PRIMARY KEY,
  loan_id INTEGER NOT NULL REFERENCES loans(id),
  text TEXT NOT NULL,
  to_number TEXT,
  status TEXT NOT NULL DEFAULT 'not_sent',
  error TEXT,
  created_at TEXT NOT NULL
);`;

// [name, phone, amount due in rupees, days overdue]. Placeholder numbers: replace them in the CRM (edit a borrower's
// phone) with numbers you control. On a Twilio trial only verified numbers can be called; anything else falls back to DEMO_PHONE_NUMBER.
const SAMPLE_LOANS = [
  ["Amit Sharma", "+910000000001", 5000, 3],
  ["Prashanth", "+910000000002", 12000, 10],
  ["Rahul Verma", "+910000000003", 3500, 1],
  ["Sneha Reddy", "+910000000004", 8000, 6],
  ["Karthik", "+910000000005", 15000, 15],
  ["Vardhan", "+910000000006", 6000, 4],
];

export const timestamp = () => nowIST().iso;

// Adds a column to an existing table if it isn't there yet - so upgrading old.js code never breaks a
// loans.db file that was created before that column existed.
function ensureColumn(table, column, definition) {
  const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export function initDb(reset = false) {
  if (reset) {
    db.exec("DROP TABLE IF EXISTS whatsapp_messages; DROP TABLE IF EXISTS payments; DROP TABLE IF EXISTS turns; DROP TABLE IF EXISTS calls; DROP TABLE IF EXISTS loans; DROP TABLE IF EXISTS agents;");
  }
  db.exec(SCHEMA);
  ensureColumn("loans", "assigned_agent_id", "INTEGER REFERENCES agents(id)");
  if (db.prepare("SELECT COUNT(*) AS n FROM loans").get().n === 0) {
    const today = nowIST().date;
    const insert = db.prepare("INSERT INTO loans (name, phone, amount_due, due_date) VALUES (?, ?, ?, ?)");
    for (const [name, phone, amount, days] of SAMPLE_LOANS) insert.run(name, phone, amount, addDays(today, -days));
  }
}

// "Reset demo data" clears call/payment/message history and makes every loan callable again, but never
// touches the loans themselves, so anything you added or edited (names, phone numbers, new borrowers) survives.
export function clearHistory() {
  db.exec("DELETE FROM whatsapp_messages; DELETE FROM payments; DELETE FROM turns; DELETE FROM calls;");
  db.exec("UPDATE loans SET status = 'due'");
  const seedAmounts = { 1: 5000, 2: 12000, 3: 3500, 4: 8000, 5: 15000, 6: 6000 };
  for (const [id, amount] of Object.entries(seedAmounts)) {
    db.prepare("UPDATE loans SET amount_due = ? WHERE id = ?").run(amount, Number(id));
  }
}