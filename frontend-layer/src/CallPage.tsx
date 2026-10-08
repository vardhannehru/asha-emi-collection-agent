import { useEffect, useRef, useState } from "react";
import "./crm.css";
import { api, post, rupees, STATUS_LABELS } from "./api";
import type { CallData, Summary, Turn } from "./api";
import { Linkify, WhatsAppStatus } from "./Linkify";

const callId = new URLSearchParams(window.location.search).get("id");

type Phase = "loading" | "live" | "ended";

function SummaryPanel({ summary }: { summary: Summary }) {
  return (
    <section className="panel dark">
      <div className="panel-top"><span>After the call</span></div>
      <dl className="facts">
        <dt>Loan status</dt>
        <dd><span className={`st ${summary.loan_status}`}>{STATUS_LABELS[summary.loan_status] || summary.loan_status}</span></dd>
        {summary.payment_url && (
          <>
            <dt>Payment link</dt>
            <dd><a className="mini-link" href={summary.payment_url} target="_blank" rel="noopener noreferrer">Open</a></dd>
          </>
        )}
      </dl>
      {summary.whatsapp && (
        <div className="wa-item">
          <small>WhatsApp message</small>
          <div><Linkify text={summary.whatsapp.text} /></div>
          <WhatsAppStatus message={summary.whatsapp} />
        </div>
      )}
    </section>
  );
}

function Transcript({ turns }: { turns: Turn[] }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.scrollTo(0, box.current.scrollHeight);
  }, [turns]);
  return (
    <div className="chat-log live-log" ref={box}>
      {turns.length === 0 && <small className="dim">Waiting for the borrower to pick up...</small>}
      {turns.map((turn, i) => (
        <div key={i} className={`msg ${turn.role}`}>
          <small>{turn.role === "agent" ? "Asha" : "Borrower"}</small>
          {turn.text}
        </div>
      ))}
    </div>
  );
}

export default function CallPage() {
  const [data, setData] = useState<CallData | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");

  async function loadSummary() {
    for (let i = 0; i < 20; i++) {
      const fresh = await api<CallData>(`/api/calls/${callId}`);
      if (fresh.summary) {
        setSummary(fresh.summary);
        setTurns(fresh.turns);
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  useEffect(() => {
    if (!callId) {
      setError("No call id in the address bar.");
      return;
    }
    let timer: ReturnType<typeof setInterval> | undefined;
    const load = async () => {
      try {
        const fresh = await api<CallData>(`/api/calls/${callId}`);
        setData(fresh);
        setTurns(fresh.turns);
        if (fresh.summary) {
          setSummary(fresh.summary);
          setPhase("ended");
          clearInterval(timer);
        } else {
          setPhase("live");
        }
      } catch (e) {
        setError((e as Error).message);
      }
    };
    load();
    timer = setInterval(load, 1000);
    return () => clearInterval(timer);
  }, []);

  async function hangUp() {
    try {
      setSummary(await post<Summary>(`/api/calls/${callId}/end`));
    } catch (e) {
      setError((e as Error).message);
    }
    setPhase("ended");
    loadSummary();
  }

  const stateLabel = phase === "ended" ? "Call ended" : "Live phone call";

  return (
    <div className="crm crm-plain">
      <a className="back-link" href="/#/calls">&larr; Back to calls</a>

      <div className="crm-head">
        <div>
          <small>{data ? `${rupees(data.loan.amount_due)} due` : " "}</small>
          <h1>Call with {data?.loan.name ?? "..."}</h1>
          <span className={`st ${phase === "ended" ? "" : "paid"}`}>{phase !== "ended" && <i className="live-dot" />}{stateLabel}</span>
        </div>
        {phase === "live" && <button className="hang-btn" onClick={hangUp}>Hang up</button>}
      </div>

      {error && <p className="crm-notice">{error}</p>}

      <div className="profile-grid">
        <section className="panel dark">
          <div className="panel-top"><span>Conversation</span></div>
          {phase !== "loading" && <Transcript turns={turns} />}
          {phase === "live" && <p className="dim live-note">The borrower is talking to Asha on the phone. The conversation appears here as it happens.</p>}
        </section>

        <div className="profile-side">
          <section className="panel grey">
            <div className="panel-top"><span>Loan</span></div>
            {data && (
              <dl className="facts">
                <dt>Borrower</dt><dd>{data.loan.name}</dd>
                <dt>Amount due</dt><dd>{rupees(data.loan.amount_due)}</dd>
                <dt>Due date</dt><dd>{data.loan.due_date}</dd>
                <dt>Channel</dt><dd>Phone call</dd>
              </dl>
            )}
          </section>
          {summary && <SummaryPanel summary={summary} />}
        </div>
      </div>
    </div>
  );
}
