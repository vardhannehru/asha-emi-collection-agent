import { useEffect, useState } from "react";
import "./crm.css";
import { ApiError, SITUATION_LABELS, STATUS_LABELS, api, callLength, rupees, whenLabel } from "./api";
import type { Agent, Loan, Profile as ProfileData, ProfileCall, Status } from "./api";
import { Linkify, WhatsAppStatus } from "./Linkify";
import Shell from "./Shell";

type Props = {
  loanId: number;
  loans: Loan[];
  status: Status | null;
  agent: Agent;
  onLogout: () => void;
  onCall: (loanId: number) => void;
  onEdit: (loan: Loan) => void;
  onPhone: (loan: Loan) => void;
  onRemove: (loan: Loan) => void;
};

function CallCard({ call, open }: { call: ProfileCall; open: boolean }) {
  const outcome = call.situation ? SITUATION_LABELS[call.situation] || call.situation : "No outcome recorded";
  return (
    <details className="call-card" open={open}>
      <summary>
        <div>
          <b>{whenLabel(call.started_at)}</b>
          <small>{call.channel === "phone" ? "Phone call" : "Browser call"} · {callLength(call.started_at, call.ended_at)} · {call.turns.length} messages</small>
        </div>
        <span className="st">{outcome}</span>
      </summary>
      {(call.promise_amount != null || (call.offer && call.offer !== "none")) && (
        <p className="call-note">
          {call.offer && call.offer !== "none" ? `Plan: ${call.offer.replace(/_/g, " ")}. ` : ""}
          {call.promise_amount != null ? `Promised ${rupees(call.promise_amount)}${call.promise_date ? ` by ${call.promise_date}` : ""}.` : ""}
        </p>
      )}
      <div className="chat-log">
        {call.turns.length === 0 && <small className="dim">Nothing was said on this call.</small>}
        {call.turns.map((turn, i) => (
          <div key={i} className={`msg ${turn.role}`}>
            <small>{turn.role === "agent" ? "Asha" : "Borrower"}</small>
            {turn.text}
          </div>
        ))}
      </div>
    </details>
  );
}

export default function Profile({ loanId, loans, status, agent, onLogout, onCall, onEdit, onPhone, onRemove }: Props) {
  const [data, setData] = useState<ProfileData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const fresh = await api<ProfileData>(`/api/loans/${loanId}/profile`);
        if (alive) {
          setData(fresh);
          setError("");
        }
      } catch (e) {
        if (alive) setError(e instanceof ApiError ? e.message : (e as Error).message);
      }
    };
    load();
    const timer = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [loanId]);

  const loan = data?.loan;
  const live = loans.find((l) => l.id === loanId);
  const paidTotal = data ? data.payments.filter((p) => p.status === "paid").reduce((s, p) => s + p.amount, 0) : 0;

  return (
    <Shell page="borrowers" agent={agent} status={status} onLogout={onLogout}>
      <a className="back-link" href="#/borrowers">&larr; Back to borrowers</a>

      {error && <p className="crm-notice">{error}</p>}
      {!data && !error && <p className="dim">Loading...</p>}

      {loan && data && (
        <>
          <div className="crm-head">
            <div>
              <small>{loan.phone} · {loan.unassigned ? "Unclaimed" : loan.assigned_to_me ? "Assigned to you" : "Assigned"}</small>
              <h1>{loan.name}</h1>
              <span className={`st ${loan.status}`}>{STATUS_LABELS[loan.status] || loan.status}</span>
              {live && (
                <div className="head-actions">
                  <button className="ghost-pill" onClick={() => onEdit(live)}>Edit loan</button>
                  <button className="ghost-pill" onClick={() => onPhone(live)}>Change phone</button>
                  <button className="ghost-pill danger" onClick={() => onRemove(live)}>Remove</button>
                </div>
              )}
            </div>
            <div className="crm-kpis">
              <div><small>Amount due</small><b>{rupees(loan.amount_due)}</b></div>
              <div><small>Overdue</small><b>{loan.days_overdue}d</b></div>
              <div><small>Calls made</small><b>{data.calls.length}</b></div>
              <div><small>Paid so far</small><b>{rupees(paidTotal)}</b></div>
            </div>
          </div>

          <div className="profile-grid">
            <section className="panel dark">
              <div className="panel-top">
                <span>Call history</span>
                {live && live.assigned_to_me && live.can_call && status?.phone_calls && (
                  <button className="lime-pill" onClick={() => onCall(loan.id)}>Call now ↗</button>
                )}
              </div>
              {data.calls.length === 0 && <p className="dim">This borrower has not been called yet.</p>}
              {data.calls.map((call, i) => <CallCard key={call.id} call={call} open={i === 0} />)}
            </section>

            <div className="profile-side">
              <section className="panel grey">
                <div className="panel-top"><span>Details</span></div>
                <dl className="facts">
                  <dt>Due date</dt><dd>{loan.due_date}</dd>
                  <dt>Calls today</dt><dd>{loan.calls_today}</dd>
                  <dt>Phone</dt><dd>{loan.phone}</dd>
                </dl>
              </section>

              <section className="panel dark">
                <div className="panel-top"><span>Payments</span></div>
                {data.payments.length === 0 && <p className="dim">No payment links yet.</p>}
                {data.payments.map((p) => (
                  <div className="row-item" key={p.id}>
                    <div>
                      <b>{rupees(p.amount)}</b>
                      <small>{whenLabel(p.created_at)}</small>
                    </div>
                    <div className="row-right">
                      <span className={`st ${p.status === "paid" ? "paid" : "due"}`}>{p.status === "paid" ? "Paid" : "Link sent"}</span>
                      {p.status !== "paid" && <a href={p.url} target="_blank" rel="noopener noreferrer">Open link</a>}
                    </div>
                  </div>
                ))}
              </section>

              <section className="panel dark">
                <div className="panel-top"><span>WhatsApp messages</span></div>
                {data.messages.length === 0 && <p className="dim">No messages sent yet.</p>}
                {data.messages.map((m) => (
                  <div className="wa-item" key={m.id}>
                    <small>{whenLabel(m.created_at)}</small>
                    <div><Linkify text={m.text} /></div>
                    <WhatsAppStatus message={m} />
                  </div>
                ))}
              </section>
            </div>
          </div>
        </>
      )}
    </Shell>
  );
}
