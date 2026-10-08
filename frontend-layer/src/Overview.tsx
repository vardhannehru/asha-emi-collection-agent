import { SITUATION_LABELS, STATUS_LABELS, rupees, whenLabel } from "./api";
import type { Agent, CallRow, Loan, Status, WhatsAppMessage } from "./api";
import { useFetch } from "./hooks";
import Shell from "./Shell";

type Props = {
  loans: Loan[];
  messages: WhatsAppMessage[];
  status: Status | null;
  agent: Agent;
  onLogout: () => void;
  onRun: () => void;
};

const RING = 2 * Math.PI * 70;

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function Overview({ loans, messages, status, agent, onLogout, onRun }: Props) {
  const { data: calls } = useFetch<CallRow[]>("/api/calls");

  const paid = loans.filter((l) => l.status === "paid").length;
  const pending = loans.length - paid;
  const paidPct = loans.length ? Math.round((paid / loans.length) * 100) : 0;
  const collected = loans.reduce((s, l) => s + (l.payment?.status === "paid" ? l.payment.amount : 0), 0);
  const outstanding = loans.reduce((s, l) => s + (l.status === "paid" ? 0 : l.amount_due), 0);
  const recovery = collected + outstanding ? Math.round((collected / (collected + outstanding)) * 100) : 0;
  const callsToday = loans.reduce((s, l) => s + l.calls_today, 0);
  const linksSent = loans.filter((l) => l.payment).length;
  const mine = loans.filter((l) => l.assigned_to_me).length;
  const unclaimed = loans.filter((l) => l.unassigned).length;

  const groups = ["due", "promised", "part_paid", "paid"].map((key) => ({
    key,
    label: STATUS_LABELS[key] || key,
    count: loans.filter((l) => l.status === key).length,
  }));
  const tallest = Math.max(1, ...groups.map((g) => g.count));

  const attention = loans
    .filter((l) => l.status !== "paid" && l.assigned_to_me && l.can_call)
    .sort((a, b) => b.days_overdue - a.days_overdue)
    .slice(0, 5);

  return (
    <Shell
      page="dashboard"
      agent={agent}
      status={status}
      onLogout={onLogout}
      eyebrow={`${greeting()}, ${agent.name}`}
      title="Dashboard"
      right={
        <div className="head-side">
          <div className="crm-kpis">
            <div><small>Outstanding</small><b>{rupees(outstanding)}</b></div>
            <div><small>Collected</small><b>{rupees(collected)}</b></div>
            <div><small>Borrowers</small><b>{loans.length}</b></div>
          </div>
        </div>
      }
    >
      <section className="crm-grid">
        <div className="crm-tiles">
          <div className="tile hatch">
            <b>{paidPct}%</b>
            <span>Paid in full</span>
            <em>{paid}/{loans.length}</em>
          </div>
          <div className="tile lime">
            <b>{loans.length ? 100 - paidPct : 0}%</b>
            <span>Still pending</span>
            <em>{pending}/{loans.length}</em>
          </div>
        </div>

        <div className="crm-analytics">
          <div>
            <small>Recovery</small>
            <div className="big">{recovery}%</div>
            <span className="chip">of total dues collected</span>
            <div className="chips">
              <span>{callsToday} call{callsToday === 1 ? "" : "s"} made today</span>
              <span>{linksSent} payment link{linksSent === 1 ? "" : "s"} sent</span>
            </div>
          </div>
          <div className="donut-wrap">
            <svg viewBox="0 0 180 180" className="donut" aria-label={`Recovery ${recovery}%`}>
              <circle cx="90" cy="90" r="70" className="ring-bg" />
              <circle cx="90" cy="90" r="70" className="ring-fg" strokeDasharray={`${(recovery / 100) * RING} ${RING}`} transform="rotate(-90 90 90)" />
            </svg>
            <div className="donut-mid">{recovery}%<small>collected</small></div>
          </div>
          <button className="round-btn" onClick={onRun} aria-label="Call next">↗</button>
        </div>
      </section>

      <section className="crm-row">
        <div className="panel dark">
          <div className="panel-top"><span>Cash collected</span><b className="tag">INR</b></div>
          <div className="cash">{rupees(collected)}</div>
          <small className="dim">Borrowers by stage</small>
          <div className="bars">
            {groups.map((g, i) => (
              <div key={g.key} className="bar-col">
                <div className={`bar b${i}`} style={{ height: `${Math.max(8, (g.count / tallest) * 100)}%` }} title={`${g.label}: ${g.count}`} />
                <small>{g.count}</small>
              </div>
            ))}
          </div>
          <div className="bar-labels">{groups.map((g) => <small key={g.key}>{g.label}</small>)}</div>
        </div>

        <div className="panel white">
          <div className="panel-top">
            <div><span>Your queue</span><small className="dim">Snapshot</small></div>
            <a className="lime-btn" href="#/borrowers" aria-label="Open borrowers">↗</a>
          </div>
          <small className="dim">Assigned to you</small>
          <div className="huge">{mine}</div>
          <small className="dim">Unclaimed: {unclaimed} · Messages: {messages.length}</small>
        </div>

        <div className="panel grey">
          <div className="panel-top"><span>Biggest dues</span></div>
          <ul className="dues">
            {loans.filter((l) => l.status !== "paid").length === 0 && <li className="dim">Everyone has paid.</li>}
            {[...loans].filter((l) => l.status !== "paid").sort((a, b) => b.amount_due - a.amount_due).slice(0, 3).map((l) => (
              <li key={l.id}><b>{rupees(l.amount_due)}</b><a href={`#/borrower/${l.id}`}>{l.name}</a></li>
            ))}
          </ul>
        </div>
      </section>

      <section className="crm-bottom even">
        <div className="panel dark">
          <div className="panel-top"><span>Recent calls</span><a className="see-all" href="#/calls">View all</a></div>
          {!calls && <p className="dim">Loading...</p>}
          {calls && calls.length === 0 && <p className="dim">No calls yet. Use "Call next" on the Borrowers page to start one.</p>}
          {calls && calls.slice(0, 5).map((c) => (
            <a className="row-item link-row" key={c.id} href={`#/borrower/${c.loan_id}`}>
              <div>
                <b>{c.name}</b>
                <small>{whenLabel(c.started_at)} · {c.turns} messages</small>
              </div>
              <span className="st">{c.situation ? SITUATION_LABELS[c.situation] || c.situation : "No outcome"}</span>
            </a>
          ))}
        </div>

        <div className="panel dark">
          <div className="panel-top"><span>Needs attention</span><a className="see-all" href="#/borrowers">All borrowers</a></div>
          {attention.length === 0 && <p className="dim">Nobody is waiting for a call right now.</p>}
          {attention.map((l) => (
            <a className="row-item link-row" key={l.id} href={`#/borrower/${l.id}`}>
              <div>
                <b>{l.name}</b>
                <small>{l.days_overdue} days overdue · {l.calls_today} call{l.calls_today === 1 ? "" : "s"} today</small>
              </div>
              <b>{rupees(l.amount_due)}</b>
            </a>
          ))}
        </div>
      </section>
    </Shell>
  );
}
