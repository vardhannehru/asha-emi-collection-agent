import { useState } from "react";
import { rupees, whenLabel } from "./api";
import type { Agent, PaymentRow, Status } from "./api";
import { useFetch } from "./hooks";
import Shell from "./Shell";

type Props = { agent: Agent; status: Status | null; onLogout: () => void };
type Filter = "all" | "paid" | "created";

export default function Payments({ agent, status, onLogout }: Props) {
  const { data: payments, error } = useFetch<PaymentRow[]>("/api/payments");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const list = payments ?? [];
  const paid = list.filter((p) => p.status === "paid");
  const waiting = list.filter((p) => p.status !== "paid");
  const sum = (rows: PaymentRow[]) => rows.reduce((s, p) => s + p.amount, 0);

  const rows = list.filter((p) => {
    if (query.trim() && !p.name.toLowerCase().includes(query.trim().toLowerCase())) return false;
    if (filter === "paid" && p.status !== "paid") return false;
    if (filter === "created" && p.status === "paid") return false;
    return true;
  });

  return (
    <Shell page="payments" agent={agent} status={status} onLogout={onLogout} eyebrow={`${list.length} payment link${list.length === 1 ? "" : "s"} created`} title="Payments">
      <section className="stat-cards">
        <div className="stat-card lime-card"><small>Collected</small><b>{rupees(sum(paid))}</b></div>
        <div className="stat-card"><small>Waiting to be paid</small><b>{rupees(sum(waiting))}</b></div>
        <div className="stat-card"><small>Paid links</small><b>{paid.length}</b></div>
        <div className="stat-card"><small>Open links</small><b>{waiting.length}</b></div>
      </section>

      <section className="panel dark crm-table">
        <div className="toolbar">
          <input className="search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by borrower" aria-label="Search payments" />
          <div className="chip-row" role="group" aria-label="Filter by status">
            <button className={`fchip ${filter === "all" ? "on" : ""}`} onClick={() => setFilter("all")}>All {list.length}</button>
            <button className={`fchip ${filter === "paid" ? "on" : ""}`} onClick={() => setFilter(filter === "paid" ? "all" : "paid")}>Paid {paid.length}</button>
            <button className={`fchip ${filter === "created" ? "on" : ""}`} onClick={() => setFilter(filter === "created" ? "all" : "created")}>Link sent {waiting.length}</button>
          </div>
        </div>

        {error && <p className="empty-rows">{error}</p>}
        <div className="scroll">
          <table>
            <thead>
              <tr><th>Created</th><th>Borrower</th><th>Amount</th><th>Status</th><th>Link</th></tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>{whenLabel(p.created_at)}<small>Payment #{p.id}</small></td>
                  <td><a className="name-link" href={`#/borrower/${p.loan_id}`}><b>{p.name}</b></a></td>
                  <td>{rupees(p.amount)}</td>
                  <td><span className={`st ${p.status === "paid" ? "paid" : "due"}`}>{p.status === "paid" ? "Paid" : "Link sent"}</span></td>
                  <td>{p.status === "paid" ? <a className="mini-link" href={p.url} target="_blank" rel="noopener noreferrer">View receipt</a> : <a className="mini-link" href={p.url} target="_blank" rel="noopener noreferrer">Open link</a>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {payments && rows.length === 0 && <p className="empty-rows">{list.length === 0 ? "No payment links yet. They are created when a borrower agrees to pay on a call." : "No payments match these filters."}</p>}
        </div>
        <small className="dim latest">Showing {rows.length} of {list.length}</small>
      </section>
    </Shell>
  );
}
