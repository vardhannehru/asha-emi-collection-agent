import { useState } from "react";
import { timeOf, whenLabel } from "./api";
import type { Agent, Status, WhatsAppMessage } from "./api";
import { Linkify, WhatsAppStatus } from "./Linkify";
import Shell from "./Shell";

type Props = {
  messages: WhatsAppMessage[];
  agent: Agent;
  status: Status | null;
  onLogout: () => void;
  onResend: (messageId: number) => void;
};

type Filter = "all" | "sent" | "failed";

export default function Messages({ messages, agent, status, onLogout, onResend }: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const sent = messages.filter((m) => m.status === "sent").length;
  const failed = messages.filter((m) => m.status === "failed").length;

  const rows = messages.filter((m) => {
    if (query.trim() && !m.name.toLowerCase().includes(query.trim().toLowerCase())) return false;
    if (filter === "sent" && m.status !== "sent") return false;
    if (filter === "failed" && m.status !== "failed") return false;
    return true;
  });

  return (
    <Shell page="messages" agent={agent} status={status} onLogout={onLogout} eyebrow={`${messages.length} WhatsApp message${messages.length === 1 ? "" : "s"}`} title="Messages">
      <section className="stat-cards three">
        <div className="stat-card"><small>Total</small><b>{messages.length}</b></div>
        <div className="stat-card lime-card"><small>Delivered</small><b>{sent}</b></div>
        <div className="stat-card"><small>Not delivered</small><b>{failed}</b></div>
      </section>

      <section className="panel dark">
        <div className="toolbar">
          <input className="search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by borrower" aria-label="Search messages" />
          <div className="chip-row" role="group" aria-label="Filter by delivery">
            <button className={`fchip ${filter === "all" ? "on" : ""}`} onClick={() => setFilter("all")}>All {messages.length}</button>
            <button className={`fchip ${filter === "sent" ? "on" : ""}`} onClick={() => setFilter(filter === "sent" ? "all" : "sent")}>Delivered {sent}</button>
            <button className={`fchip ${filter === "failed" ? "on" : ""}`} onClick={() => setFilter(filter === "failed" ? "all" : "failed")}>Not delivered {failed}</button>
          </div>
        </div>

        <div className="msg-grid">
          {rows.map((m) => (
            <article className="wa-card" key={m.id}>
              <div className="wa-meta">
                <a className="name-link" href={`#/borrower/${m.loan_id}`}><b>{m.name}</b></a>
                <small>{whenLabel(m.created_at)} · {timeOf(m.created_at)}</small>
              </div>
              <div className="wa-body"><Linkify text={m.text} /></div>
              <WhatsAppStatus message={m} />
              <button className="ghost-pill small-pill" onClick={() => onResend(m.id)}>Resend</button>
            </article>
          ))}
        </div>
        {rows.length === 0 && <p className="empty-rows">{messages.length === 0 ? "Messages sent after calls show up here." : "No messages match these filters."}</p>}
      </section>
    </Shell>
  );
}
