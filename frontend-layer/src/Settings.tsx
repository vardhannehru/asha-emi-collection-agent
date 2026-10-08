import type { Agent, Status } from "./api";
import Shell from "./Shell";

type Props = { agent: Agent; status: Status | null; onLogout: () => void; onReset: () => void };

export default function Settings({ agent, status, onLogout, onReset }: Props) {
  const services: [string, string, boolean][] = status
    ? [
        ["AI agent", status.agent, status.ai_layer],
        ["Phone calls", status.phone_calls ? `On (${status.phone_mode})` : "Off", status.phone_calls],
        ["WhatsApp", status.whatsapp ? "On" : "Not set up", status.whatsapp],
        ["Payments", status.payments, true],
        ["Calling hours rule", status.enforce_call_hours ? "On" : "Off", status.enforce_call_hours],
      ]
    : [];

  return (
    <Shell page="settings" agent={agent} status={status} onLogout={onLogout} eyebrow={status ? `${status.lender} · ${status.now_ist}` : "Connecting..."} title="Settings">
      <section className="settings-grid">
        <div className="panel dark">
          <div className="panel-top"><span>System status</span></div>
          {!status && <p className="dim">Loading...</p>}
          {services.map(([name, value, good]) => (
            <div className="row-item" key={name}>
              <b>{name}</b>
              <span className={`st ${good ? "paid" : "due"}`}>{value}</span>
            </div>
          ))}
        </div>

        <div className="panel dark">
          <div className="panel-top"><span>Our calling rules</span></div>
          {status ? <ul className="rule-list">{status.rules.map((rule) => <li key={rule}>{rule}</li>)}</ul> : <p className="dim">Loading...</p>}
        </div>

        <div className="panel dark">
          <div className="panel-top"><span>Your account</span></div>
          <dl className="facts">
            <dt>Name</dt><dd>{agent.name}</dd>
            <dt>Agent ID</dt><dd>#{agent.id}</dd>
          </dl>
          <div className="pill-row action-gap">
            <button className="ghost-pill" onClick={onLogout}>Log out</button>
          </div>
        </div>

        <div className="panel dark">
          <div className="panel-top"><span>Demo tools</span></div>
          <p className="dim">Clears every call, payment and message, and makes all loans callable again. Borrower names and phone numbers are kept.</p>
          <div className="pill-row action-gap">
            <button className="ghost-pill danger" onClick={onReset}>Reset demo data</button>
          </div>
        </div>
      </section>
    </Shell>
  );
}
