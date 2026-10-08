import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import "./dialogs.css";

const todayLocal = () => new Date().toLocaleDateString("en-CA");

function Overlay({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="dlg-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dlg" role="dialog" aria-modal="true">{children}</div>
    </div>
  );
}

export type LoanValues = { name: string; phone: string; amount_due: number; due_date: string };

type LoanDialogProps = {
  mode: "add" | "edit" | "phone";
  initial?: Partial<LoanValues>;
  onSubmit: (values: LoanValues) => Promise<void>;
  onClose: () => void;
};

const TITLES = { add: "Add a loan", edit: "Edit loan", phone: "Change phone number" };

export function LoanDialog({ mode, initial, onSubmit, onClose }: LoanDialogProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [amount, setAmount] = useState(initial?.amount_due != null ? String(initial.amount_due) : "");
  const [due, setDue] = useState(initial?.due_date ?? todayLocal());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const showName = mode !== "phone";
  const showPhone = mode !== "edit";
  const showMoney = mode !== "phone";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const digits = phone.replace(/\D/g, "");
    if (showName && !name.trim()) return setError("Enter the borrower's name.");
    if (showPhone && mode === "phone" && digits.length < 10) return setError("Enter the full phone number with country code.");
    if (showPhone && mode === "add" && phone.trim() && digits.length < 10) return setError("That phone number looks too short. Include the country code, e.g. +91...");
    if (showMoney && !(Number(amount) > 0)) return setError("Enter an amount greater than zero.");
    if (showMoney && !due) return setError("Pick a due date.");
    setBusy(true);
    setError("");
    try {
      await onSubmit({ name: name.trim(), phone: phone.trim(), amount_due: Number(amount), due_date: due });
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Overlay onClose={onClose}>
      <form onSubmit={submit}>
        <h2>{TITLES[mode]}</h2>
        {error && <p className="dlg-error">{error}</p>}

        {showName && (
          <label>Borrower name
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Karthik" />
          </label>
        )}
        {showPhone && (
          <label>Phone number
            <input autoFocus={mode === "phone"} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" inputMode="tel" />
            <small>With country code. To really ring it, the number must be verified in Twilio.</small>
          </label>
        )}
        {showMoney && (
          <div className="dlg-two">
            <label>Amount due (₹)
              <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} placeholder="15000" inputMode="numeric" />
            </label>
            <label>Due date
              <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </label>
          </div>
        )}

        <div className="dlg-actions">
          <button type="button" className="dlg-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="dlg-main" disabled={busy}>{busy ? "Saving..." : mode === "add" ? "Add loan" : "Save"}</button>
        </div>
      </form>
    </Overlay>
  );
}

type ConfirmProps = {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
};

export function ConfirmDialog({ title, message, confirmLabel, danger, onConfirm, onClose }: ConfirmProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function go() {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Overlay onClose={onClose}>
      <h2>{title}</h2>
      <p className="dlg-text">{message}</p>
      {error && <p className="dlg-error">{error}</p>}
      <div className="dlg-actions">
        <button type="button" className="dlg-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className={danger ? "dlg-danger" : "dlg-main"} onClick={go} disabled={busy}>{busy ? "Please wait..." : confirmLabel}</button>
      </div>
    </Overlay>
  );
}
