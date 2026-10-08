export type Status = {
  ai_layer: boolean;
  agent: string;
  payments: string;
  phone_calls: boolean;
  phone_mode: string;
  whatsapp: boolean;
  enforce_call_hours: boolean;
  rules: string[];
  offers: Record<string, string>;
  lender: string;
  now_ist: string;
};

export type Loan = {
  id: number;
  name: string;
  phone: string;
  amount_due: number;
  due_date: string;
  status: string;
  days_overdue: number;
  calls_today: number;
  can_call: boolean;
  blocked_reason: string | null;
  dial_to: string | null;
  dial_is_own: boolean;
  assigned_to_me: boolean;
  unassigned: boolean;
  last_call: { situation: string | null; offer: string | null; promise_amount: number | null; promise_date: string | null } | null;
  payment: { id: number; url: string; amount: number; status: string } | null;
};

export type Agent = { id: number; name: string };

export type WhatsAppInfo = { text: string; status: string; error: string | null; to_number: string | null };
export type WhatsAppMessage = WhatsAppInfo & { id: number; loan_id: number; created_at: string; name: string };
export type Summary = { loan_status: string; payment_url: string | null; whatsapp: WhatsAppInfo | null };
export type Turn = { role: string; text: string; created_at?: string };

export type CallData = {
  call: { id: number; channel: string; ended_at: string | null; situation: string | null; offer: string | null };
  loan: { id: number; name: string; amount_due: number; due_date: string };
  turns: Turn[];
  summary: Summary | null;
};

export type ProfileCall = {
  id: number;
  channel: string;
  started_at: string;
  ended_at: string | null;
  situation: string | null;
  offer: string | null;
  promise_amount: number | null;
  promise_date: string | null;
  turns: Turn[];
};

export type Profile = {
  loan: {
    id: number;
    name: string;
    phone: string;
    amount_due: number;
    due_date: string;
    status: string;
    days_overdue: number;
    calls_today: number;
    assigned_to_me: boolean;
    unassigned: boolean;
  };
  calls: ProfileCall[];
  payments: { id: number; url: string; amount: number; status: string; created_at: string }[];
  messages: (WhatsAppInfo & { id: number; created_at: string })[];
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { headers: { "Content-Type": "application/json" }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, data.detail || `Request failed (${response.status})`);
  return data as T;
}

export const post = <T,>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const rupees = (amount: number) => "₹" + Number(amount).toLocaleString("en-IN");

export const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export const SITUATION_LABELS: Record<string, string> = {
  unknown: "Not clear yet",
  will_pay_now: "Will pay now",
  forgot: "Forgot to pay",
  short_on_cash: "Short on cash",
  hardship: "Financial hardship",
  dispute: "Disputes the loan",
  wrong_number: "Wrong number",
  refused: "Refused / busy",
};

export const STATUS_LABELS: Record<string, string> = {
  due: "Due",
  promised: "Promised to pay",
  part_paid: "Part paid",
  paid: "Paid",
  disputed: "Disputed",
  do_not_call: "Wrong number",
};

export type CallRow = {
  id: number;
  loan_id: number;
  name: string;
  channel: string;
  started_at: string;
  ended_at: string | null;
  situation: string | null;
  offer: string | null;
  promise_amount: number | null;
  promise_date: string | null;
  turns: number;
};

export type PaymentRow = { id: number; loan_id: number; name: string; url: string; amount: number; status: string; created_at: string };

export const whenLabel = (iso: string) =>
  new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function callLength(start: string, end: string | null) {
  if (!end) return "in progress";
  const seconds = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000));
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}
