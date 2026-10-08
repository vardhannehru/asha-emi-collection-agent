import { useMemo, useState } from "react";
import { SITUATION_LABELS, STATUS_LABELS, rupees } from "./api";
import type { Agent, Loan, Status } from "./api";
import Shell from "./Shell";
import SpecularButton from "./SpecularButton";

type Props = {
  loans: Loan[];
  status: Status | null;
  agent: Agent;
  onLogout: () => void;
  onRun: () => void;
  onAuto: () => void;
  autoRunning: boolean;
  onCall: (loanId: number) => void;
  onAdd: () => void;
  onClaim: (loan: Loan) => void;
  onRelease: (loan: Loan) => void;
};

type SortKey = "name" | "amount" | "due" | "stage";
type Owner = "all" | "mine" | "unclaimed";

const STAGE_ORDER = ["due", "promised", "part_paid", "paid", "disputed", "do_not_call"];

export default function Borrowers({ loans, status, agent, onLogout, onRun, onAuto, autoRunning, onCall, onAdd, onClaim, onRelease }: Props) {
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState("all");
  const [owner, setOwner] = useState<Owner>("all");
  const [overdue30, setOverdue30] = useState(false);
  const [ready, setReady] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("due");
  const [sortDown, setSortDown] = useState(true);

  const mine = loans.filter((l) => l.assigned_to_me).length;
  const unclaimed = loans.filter((l) => l.unassigned).length;

  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const l of loans) counts[l.status] = (counts[l.status] || 0) + 1;
    return counts;
  }, [loans]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    const list = loans.filter((l) => {
      if (q && !(l.name.toLowerCase().includes(q) || (digits.length >= 3 && l.phone.replace(/\D/g, "").includes(digits)))) return false;
      if (stage !== "all" && l.status !== stage) return false;
      if (owner === "mine" && !l.assigned_to_me) return false;
      if (owner === "unclaimed" && !l.unassigned) return false;
      if (overdue30 && l.days_overdue < 30) return false;
      if (ready && !(l.assigned_to_me && l.can_call)) return false;
      return true;
    });
    const dir = sortDown ? -1 : 1;
    const value = (l: Loan) =>
      sortKey === "name" ? l.name.toLowerCase()
        : sortKey === "amount" ? l.amount_due
        : sortKey === "due" ? l.days_overdue
        : STAGE_ORDER.indexOf(l.status);
    return [...list].sort((a, b) => (value(a) < value(b) ? -1 : value(a) > value(b) ? 1 : 0) * dir);
  }, [loans, query, stage, owner, overdue30, ready, sortKey, sortDown]);

  const filtering = query.trim() !== "" || stage !== "all" || owner !== "all" || overdue30 || ready;

  function sortBy(key: SortKey) {
    if (key === sortKey) setSortDown(!sortDown);
    else {
      setSortKey(key);
      setSortDown(key !== "name");
    }
  }

  function clearFilters() {
    setQuery("");
    setStage("all");
    setOwner("all");
    setOverdue30(false);
    setReady(false);
  }

  const arrow = (key: SortKey) => (sortKey === key ? (sortDown ? " ↓" : " ↑") : "");
  const Th = ({ k, children }: { k: SortKey; children: string }) => (
    <th><button className="th-sort" onClick={() => sortBy(k)}>{children}{arrow(k)}</button></th>
  );

  return (
    <Shell
      page="borrowers"
      agent={agent}
      status={status}
      onLogout={onLogout}
      eyebrow={`${loans.length} in total · ${mine} yours · ${unclaimed} unclaimed`}
      title="Borrowers"
      right={
        <div className="pill-row">
          <button className="ghost-pill" onClick={onAdd}>+ Add loan</button>
          <SpecularButton size="sm" radius={999} tint="#ac58e9" tintOpacity={0.9} textColor="#fff" lineColor="#ffffff" baseColor="#3a1a5c" onClick={onAuto} disabled={autoRunning}>{autoRunning ? "Calling..." : "AUTOMATE CALLS"}</SpecularButton>
          <SpecularButton size="sm" radius={999} tint="#ffffff" tintOpacity={0.08} textColor="#fff" lineColor="#ffffff" baseColor="#555" onClick={onRun} disabled={autoRunning}>CALL NEXT ↗</SpecularButton>
        </div>
      }
    >
      <section className="panel dark crm-table">
        <div className="toolbar">
          <input
            className="search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or phone"
            aria-label="Search borrowers"
          />
          <div className="chip-row" role="group" aria-label="Filter by stage">
            <button className={`fchip ${stage === "all" ? "on" : ""}`} onClick={() => setStage("all")}>All {loans.length}</button>
            {STAGE_ORDER.filter((s) => stageCounts[s]).map((s) => (
              <button key={s} className={`fchip ${stage === s ? "on" : ""}`} onClick={() => setStage(stage === s ? "all" : s)}>
                {STATUS_LABELS[s] || s} {stageCounts[s]}
              </button>
            ))}
          </div>
          <div className="chip-row" role="group" aria-label="More filters">
            <button className={`fchip ${owner === "mine" ? "on" : ""}`} onClick={() => setOwner(owner === "mine" ? "all" : "mine")}>Mine {mine}</button>
            <button className={`fchip ${owner === "unclaimed" ? "on" : ""}`} onClick={() => setOwner(owner === "unclaimed" ? "all" : "unclaimed")}>Unclaimed {unclaimed}</button>
            <button className={`fchip ${overdue30 ? "on" : ""}`} onClick={() => setOverdue30(!overdue30)}>30+ days overdue</button>
            <button className={`fchip ${ready ? "on" : ""}`} onClick={() => setReady(!ready)}>Ready to call</button>
            {filtering && <button className="fchip clear" onClick={clearFilters}>Clear filters</button>}
          </div>
        </div>

        <div className="scroll">
          <table>
            <thead>
              <tr>
                <Th k="name">Borrower</Th>
                <Th k="amount">Amount</Th>
                <Th k="due">Due</Th>
                <Th k="stage">Stage</Th>
                <th>Last call</th>
                <th>Payment</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id}>
                  <td>
                    <a className="name-link" href={`#/borrower/${l.id}`}><b>{l.name}</b></a>
                    <small>{l.phone}</small>
                    <small className="owner">
                      {l.unassigned ? (
                        <>Unclaimed · <button className="text-btn" onClick={() => onClaim(l)}>claim</button></>
                      ) : l.assigned_to_me ? (
                        <>Yours · <button className="text-btn" onClick={() => onRelease(l)}>release</button></>
                      ) : "Another agent"}
                    </small>
                  </td>
                  <td>{rupees(l.amount_due)}</td>
                  <td>{l.due_date}<small>{l.days_overdue}d overdue · {l.calls_today} call{l.calls_today === 1 ? "" : "s"} today</small></td>
                  <td><span className={`st ${l.status}`}>{STATUS_LABELS[l.status] || l.status}</span></td>
                  <td>
                    {l.last_call ? (
                      <>
                        {SITUATION_LABELS[l.last_call.situation || "unknown"] || "Not clear yet"}
                        <small>
                          {l.last_call.offer && l.last_call.offer !== "none" ? status?.offers[l.last_call.offer] || "Plan agreed" : "No plan agreed"}
                          {l.last_call.promise_amount != null ? ` · ${rupees(l.last_call.promise_amount)} by ${l.last_call.promise_date}` : ""}
                        </small>
                      </>
                    ) : <small>Not called yet</small>}
                  </td>
                  <td>
                    {l.payment ? (
                      <>
                        {l.payment.status === "paid" ? "Paid" : "Link sent"} · {rupees(l.payment.amount)}
                        {l.payment.status !== "paid" && <small><a className="mini-link" href={l.payment.url} target="_blank" rel="noopener noreferrer">Open link</a></small>}
                      </>
                    ) : <small>-</small>}
                  </td>
                  <td>
                    {(() => {
                      const reason = l.unassigned ? "Claim first" : !l.assigned_to_me ? "Not yours" : !status?.phone_calls ? "Phone calls not set up" : l.blocked_reason || "";
                      const ok = l.assigned_to_me && l.can_call && !!status?.phone_calls && !autoRunning;
                      return (
                        <>
                          <button className="lime-pill" onClick={() => onCall(l.id)} disabled={!ok} title={reason}>Call</button>
                          {reason && <small>{reason}</small>}
                        </>
                      );
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <p className="empty-rows">
              {loans.length === 0 ? "No borrowers yet. Use “+ Add loan” to add the first one." : "No borrowers match these filters."}
              {filtering && <> <button className="text-btn" onClick={clearFilters}>Clear filters</button></>}
            </p>
          )}
        </div>
        <small className="dim latest">Showing {rows.length} of {loans.length}</small>
      </section>
    </Shell>
  );
}
