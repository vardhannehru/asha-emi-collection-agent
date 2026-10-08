import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, post } from "./api";
import type { Agent, CallData, Loan, Status, WhatsAppMessage } from "./api";
import Landing from "./Landing";
import Overview from "./Overview";
import Borrowers from "./Borrowers";
import Calls from "./Calls";
import Payments from "./Payments";
import Messages from "./Messages";
import Settings from "./Settings";
import Profile from "./Profile";
import type { Page } from "./Shell";
import Toast from "./Toast";
import { ConfirmDialog, LoanDialog } from "./Dialogs";
import type { LoanValues } from "./Dialogs";

type View = Page | "profile";

type Dialog =
  | { kind: "add" }
  | { kind: "edit"; loan: Loan }
  | { kind: "phone"; loan: Loan }
  | { kind: "confirm"; title: string; message: string; confirmLabel: string; danger?: boolean; run: () => Promise<void> }
  | null;

// Which page the address bar points at. Unknown addresses (and the old #/crm) open the dashboard.
function viewFromHash(): View {
  const hash = window.location.hash;
  if (hash.startsWith("#/borrower/")) return "profile";
  for (const page of ["borrowers", "calls", "payments", "messages", "settings"] as const) {
    if (hash.startsWith(`#/${page}`)) return page;
  }
  return "dashboard";
}

export default function Dashboard() {
  const [agent, setAgent] = useState<Agent | null | undefined>(undefined); // undefined = still checking
  const [status, setStatus] = useState<Status | null>(null);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [toast, setToast] = useState<{ text: string; kind: "ok" | "bad" } | null>(null);
  const setNotice = useCallback((text: string, kind: "ok" | "bad" = "bad") => setToast(text ? { text, kind } : null), []);
  const [view, setView] = useState<View>(viewFromHash);
  const [hash, setHash] = useState(window.location.hash);
  const [dialog, setDialog] = useState<Dialog>(null);

  useEffect(() => {
    const onHash = () => {
      setHash(window.location.hash);
      setView(viewFromHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    api<Agent>("/api/auth/me").then(setAgent).catch(() => setAgent(null));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [l, m] = await Promise.all([api<Loan[]>("/api/loans"), api<WhatsAppMessage[]>("/api/whatsapp")]);
      setLoans(l);
      setMessages(m);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setAgent(null); // session expired: back to the login screen
      else setNotice((error as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!agent) return;
    api<Status>("/api/status").then(setStatus).catch((e) => setNotice(e.message));
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [agent, refresh]);

  const clearNotice = useCallback(() => setToast(null), []);

  async function logout() {
    await post("/api/auth/logout");
    setAgent(null);
    setLoans([]);
    setMessages([]);
  }

  const [auto, setAuto] = useState({ running: false, name: "", done: 0, stopping: false });
  const stopAuto = useRef(false);

  async function startCall(loanId: number) {
    try {
      const { call_id } = await post<{ call_id: number }>("/api/calls", { loan_id: loanId, channel: "phone" });
      window.location.href = `/call?id=${call_id}`;
    } catch (error) {
      setNotice((error as Error).message);
      refresh();
    }
  }

  async function runScheduler() {
    try {
      const next = await post<{ loan_id: number | null; reason?: string }>("/api/scheduler/next");
      if (next.loan_id) startCall(next.loan_id);
      else setNotice(next.reason || "Nobody is ready to be called right now.");
    } catch (error) {
      setNotice((error as Error).message);
    }
  }

  // Calls every ready loan one after another, staying on this page. Stops when nobody is left, on error, or when asked.
  async function callAll() {
    if (auto.running) return;
    stopAuto.current = false;
    const tried = new Set<number>();
    let done = 0;
    setAuto({ running: true, name: "", done: 0, stopping: false });
    try {
      while (!stopAuto.current) {
        const next = await post<{ loan_id: number | null; name?: string; reason?: string }>("/api/scheduler/next", { skip: [...tried] });
        if (!next.loan_id || tried.has(next.loan_id)) {
          if (!done) setNotice(next.reason || "Nobody is ready to be called right now.");
          break;
        }
        tried.add(next.loan_id);
        setAuto({ running: true, name: next.name || "", done, stopping: false });
        const { call_id } = await post<{ call_id: number }>("/api/calls", { loan_id: next.loan_id, channel: "phone" });
        const started = Date.now();
        for (;;) {
          await new Promise((r) => setTimeout(r, 3000));
          const data = await api<CallData>(`/api/calls/${call_id}`);
          if (data.call.ended_at) break;
          if (Date.now() - started > 8 * 60 * 1000) {
            await post(`/api/calls/${call_id}/end`);
            break;
          }
        }
        done += 1;
        refresh();
        await new Promise((r) => setTimeout(r, 2000));
      }
      if (done) setNotice(`Finished. ${done} call${done === 1 ? "" : "s"} made.`, "ok");
    } catch (error) {
      setNotice((error as Error).message);
    }
    setAuto({ running: false, name: "", done: 0, stopping: false });
    refresh();
  }

  function stopCalling() {
    stopAuto.current = true;
    setAuto((a) => ({ ...a, stopping: true }));
  }

  // Runs one action and shows any failure as a notice, then reloads the data.
  async function act(run: () => Promise<unknown>, success = "") {
    try {
      await run();
      setNotice(success, "ok");
    } catch (error) {
      setNotice((error as Error).message);
    }
    refresh();
  }

  const claimLoan = (loan: Loan) => act(() => post(`/api/loans/${loan.id}/claim`), `${loan.name} is now in your queue.`);
  const resendMessage = (messageId: number) => act(() => post(`/api/whatsapp/${messageId}/resend`), "Message resent!");

  function ask(title: string, message: string, confirmLabel: string, run: () => Promise<void>, danger = false) {
    setDialog({ kind: "confirm", title, message, confirmLabel, danger, run });
  }

  const reset = () =>
    ask(
      "Reset demo data?",
      "This clears all calls, payments and messages, and makes every loan callable again. Your loans, names and phone numbers are kept.",
      "Reset",
      async () => {
        await post("/api/reset");
        setNotice("Demo data reset.", "ok");
        refresh();
      },
    );

  const releaseLoan = (loan: Loan) =>
    ask(`Release ${loan.name}?`, "This puts the borrower back in the shared pool so another agent can take them.", "Release", async () => {
      await post(`/api/loans/${loan.id}/release`);
      setNotice("");
      refresh();
    });

  const removeLoan = (loan: Loan) =>
    ask(
      `Remove ${loan.name}?`,
      "This deletes the borrower and all of their calls, payments and messages. It cannot be undone.",
      "Remove",
      async () => {
        await post(`/api/loans/${loan.id}/delete`);
        setNotice(`${loan.name} was removed.`, "ok");
        if (window.location.hash.startsWith("#/borrower/")) window.location.hash = "#/borrowers";
        refresh();
      },
      true,
    );

  const changePhone = (loan: Loan) => setDialog({ kind: "phone", loan });
  const editLoan = (loan: Loan) => setDialog({ kind: "edit", loan });
  const addLoan = () => setDialog({ kind: "add" });

  async function submitLoan(state: Extract<Dialog, { kind: "add" | "edit" | "phone" }>, v: LoanValues) {
    if (state.kind === "add") await post("/api/loans", v);
    else if (state.kind === "edit") await post(`/api/loans/${state.loan.id}`, { name: v.name, amount_due: v.amount_due, due_date: v.due_date });
    else await post(`/api/loans/${state.loan.id}/phone`, { phone: v.phone });
    setNotice(state.kind === "add" ? `${v.name} was added.` : "Saved.", "ok");
    refresh();
  }

  if (agent === undefined) return null; // checking whether you're already logged in
  if (agent === null) return <Landing onSignedIn={setAgent} />;

  return (
    <div className="app" id="top">
      {view === "dashboard" && (
        <Overview loans={loans} messages={messages} status={status} agent={agent} onLogout={logout} onRun={runScheduler} />
      )}

      {view === "borrowers" && (
        <Borrowers
          loans={loans}
          status={status}
          agent={agent}
          onLogout={logout}
          onRun={runScheduler}
          onAuto={callAll}
          autoRunning={auto.running}
          onCall={startCall}
          onAdd={addLoan}
          onClaim={claimLoan}
          onRelease={releaseLoan}
        />
      )}

      {auto.running && (
        <div className="auto-bar">
          <span className="live-dot" />
          <div>
            <b>{auto.stopping ? "Stopping after this call..." : auto.name ? `Calling ${auto.name}` : "Finding the next borrower..."}</b>
            <small>{auto.done} call{auto.done === 1 ? "" : "s"} done · one at a time</small>
          </div>
          <button className="ghost-pill" onClick={stopCalling} disabled={auto.stopping}>Stop</button>
        </div>
      )}

      {view === "calls" && <Calls agent={agent} status={status} onLogout={logout} />}

      {view === "payments" && <Payments agent={agent} status={status} onLogout={logout} />}

      {view === "messages" && <Messages messages={messages} agent={agent} status={status} onLogout={logout} onResend={resendMessage} />}

      {view === "settings" && <Settings agent={agent} status={status} onLogout={logout} onReset={reset} />}

      {view === "profile" && (
        <Profile
          loanId={Number(hash.split("/")[2])}
          loans={loans}
          status={status}
          agent={agent}
          onLogout={logout}
          onCall={startCall}
          onEdit={editLoan}
          onPhone={changePhone}
          onRemove={removeLoan}
        />
      )}

      {dialog && dialog.kind !== "confirm" && (
        <LoanDialog
          mode={dialog.kind}
          initial={dialog.kind === "add" ? undefined : dialog.loan}
          onSubmit={(values) => submitLoan(dialog, values)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog && dialog.kind === "confirm" && (
        <ConfirmDialog
          title={dialog.title}
          message={dialog.message}
          confirmLabel={dialog.confirmLabel}
          danger={dialog.danger}
          onConfirm={dialog.run}
          onClose={() => setDialog(null)}
        />
      )}

      {toast && <Toast text={toast.text} kind={toast.kind} onClose={clearNotice} />}
    </div>
  );
}
