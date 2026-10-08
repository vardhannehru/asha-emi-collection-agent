import { Fragment, useMemo, useState } from "react";
import { SITUATION_LABELS, api, callLength, rupees, whenLabel } from "./api";
import type { Agent, CallData, CallRow, Status, Turn } from "./api";
import { useFetch } from "./hooks";
import Shell from "./Shell";

type Props = { agent: Agent; status: Status | null; onLogout: () => void };

const sameDay = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

export default function Calls({ agent, status, onLogout }: Props) {
  const { data: calls, error } = useFetch<CallRow[]>("/api/calls");
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState("all");
  const [open, setOpen] = useState<number | null>(null);
  const [transcripts, setTranscripts] = useState<Record<number, Turn[] | "error">>({});

  const list = calls ?? [];
  const today = list.filter((c) => sameDay(c.started_at)).length;
  const withPlan = list.filter((c) => c.offer && c.offer !== "none").length;
  const finished = list.filter((c) => c.ended_at);
  const avgSeconds = finished.length
    ? Math.round(finished.reduce((s, c) => s + (new Date(c.ended_at!).getTime() - new Date(c.started_at).getTime()) / 1000, 0) / finished.length)
    : 0;

  const outcomes = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of list) counts[c.situation || "unknown"] = (counts[c.situation || "unknown"] || 0) + 1;
    return counts;
  }, [list]);

  const rows = list.filter((c) => {
    if (query.trim() && !c.name.toLowerCase().includes(query.trim().toLowerCase())) return false;
    if (outcome !== "all" && (c.situation || "unknown") !== outcome) return false;
    return true;
  });

  async function toggle(id: number) {
    if (open === id) return setOpen(null);
    setOpen(id);
    if (transcripts[id]) return;
    try {
      const data = await api<CallData>(`/api/calls/${id}`);
      setTranscripts((t) => ({ ...t, [id]: data.turns }));
    } catch {
      setTranscripts((t) => ({ ...t, [id]: "error" }));
    }
  }

  return (
    <Shell page="calls" agent={agent} status={status} onLogout={onLogout} eyebrow={`${list.length} call${list.length === 1 ? "" : "s"} on record`} title="Calls">
      <section className="stat-cards">
        <div className="stat-card"><small>Total calls</small><b>{list.length}</b></div>
        <div className="stat-card"><small>Today</small><b>{today}</b></div>
        <div className="stat-card"><small>Plans agreed</small><b>{withPlan}</b></div>
        <div className="stat-card"><small>Average length</small><b>{avgSeconds >= 60 ? `${Math.floor(avgSeconds / 60)}m ${avgSeconds % 60}s` : `${avgSeconds}s`}</b></div>
      </section>

      <section className="panel dark crm-table">
        <div className="toolbar">
          <input className="search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by borrower" aria-label="Search calls" />
          <div className="chip-row" role="group" aria-label="Filter by outcome">
            <button className={`fchip ${outcome === "all" ? "on" : ""}`} onClick={() => setOutcome("all")}>All {list.length}</button>
            {Object.entries(outcomes).map(([key, count]) => (
              <button key={key} className={`fchip ${outcome === key ? "on" : ""}`} onClick={() => setOutcome(outcome === key ? "all" : key)}>
                {SITUATION_LABELS[key] || key} {count}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="empty-rows">{error}</p>}
        <div className="scroll">
          <table>
            <thead>
              <tr><th>When</th><th>Borrower</th><th>Length</th><th>Outcome</th><th>Plan</th><th>Messages</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <Fragment key={c.id}>
                  <tr className={open === c.id ? "open-row" : ""}>
                    <td>{whenLabel(c.started_at)}<small>{c.channel === "phone" ? "Phone call" : "Browser call"}</small></td>
                    <td><a className="name-link" href={`#/borrower/${c.loan_id}`}><b>{c.name}</b></a></td>
                    <td>{callLength(c.started_at, c.ended_at)}</td>
                    <td><span className="st">{c.situation ? SITUATION_LABELS[c.situation] || c.situation : "No outcome"}</span></td>
                    <td>
                      {c.offer && c.offer !== "none" ? (status?.offers[c.offer] || "Plan agreed") : <small>None</small>}
                      {c.promise_amount != null && <small>{rupees(c.promise_amount)} by {c.promise_date}</small>}
                    </td>
                    <td>{c.turns}</td>
                    <td><button className="ghost-pill small-pill" onClick={() => toggle(c.id)}>{open === c.id ? "Hide" : "Transcript"}</button></td>
                  </tr>
                  {open === c.id && (
                    <tr className="detail-row">
                      <td colSpan={7}>
                        {!transcripts[c.id] && <small className="dim">Loading...</small>}
                        {transcripts[c.id] === "error" && <small className="dim">Could not load this transcript.</small>}
                        {Array.isArray(transcripts[c.id]) && (
                          <div className="chat-log">
                            {(transcripts[c.id] as Turn[]).length === 0 && <small className="dim">Nothing was said on this call.</small>}
                            {(transcripts[c.id] as Turn[]).map((turn, i) => (
                              <div key={i} className={`msg ${turn.role}`}>
                                <small>{turn.role === "agent" ? "Asha" : "Borrower"}</small>
                                {turn.text}
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          {calls && rows.length === 0 && <p className="empty-rows">{list.length === 0 ? "No calls yet. Start one from Borrowers or the Dashboard." : "No calls match these filters."}</p>}
        </div>
        <small className="dim latest">Showing {rows.length} of {list.length}</small>
      </section>
    </Shell>
  );
}
