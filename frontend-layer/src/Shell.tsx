import type { ReactNode } from "react";
import "./crm.css";
import type { Agent, Status } from "./api";
import BorderGlow from "./BorderGlow";
import Logo from "./Logo";

export type Page = "dashboard" | "borrowers" | "calls" | "payments" | "messages" | "settings";

const ICONS: Record<Page, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="2" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" />
    </>
  ),
  borrowers: (
    <>
      <circle cx="9" cy="8" r="3.3" /><path d="M3 20c0-3.6 2.7-6 6-6s6 2.4 6 6" />
      <path d="M16 5.2a3 3 0 0 1 0 5.7M18.6 14.6c1.5.9 2.4 2.7 2.4 5.4" />
    </>
  ),
  calls: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />,
  payments: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M2.5 10h19M6 15h4" />
    </>
  ),
  messages: <path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H10l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />,
  settings: (
    <>
      <path d="M4 7h9M19 7h1M4 17h1M11 17h9" /><circle cx="16" cy="7" r="2.3" /><circle cx="8" cy="17" r="2.3" />
    </>
  ),
};

const NAV: { page: Page; label: string; href: string }[] = [
  { page: "dashboard", label: "Dashboard", href: "#/dashboard" },
  { page: "borrowers", label: "Borrowers", href: "#/borrowers" },
  { page: "calls", label: "Calls", href: "#/calls" },
  { page: "payments", label: "Payments", href: "#/payments" },
  { page: "messages", label: "Messages", href: "#/messages" },
  { page: "settings", label: "Settings", href: "#/settings" },
];

type Props = {
  page: Page;
  agent: Agent;
  status: Status | null;
  onLogout: () => void;
  title?: string;
  eyebrow?: string;
  right?: ReactNode;
  children: ReactNode;
};

// The frame around every signed-in page: a sidebar on the left, and a header + content on the right.
export default function Shell({ page, agent, status, onLogout, title, eyebrow, right, children }: Props) {
  return (
    <div className="crm shell">
      <aside className="side">
        <a className="side-brand" href="#/dashboard">
          <Logo className="brand-mark" />
          <span>asha</span>
        </a>

        <nav className="side-nav" aria-label="Main">
          {NAV.map((item) => (
            <BorderGlow key={item.page} className={`nav-glow ${page === item.page ? "on" : ""}`} backgroundColor="#0a0a0c" borderRadius={14} glowColor="277 75 66" colors={["#ac58e9", "#7c3aed", "#e0b3ff"]} fillOpacity={0.3} glowRadius={16} edgeSensitivity={20}>
            <a href={item.href} className={page === item.page ? "on" : ""} aria-current={page === item.page ? "page" : undefined}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {ICONS[item.page]}
              </svg>
              <span>{item.label}</span>
            </a>
            </BorderGlow>
          ))}
        </nav>

        <div className="side-foot">
          <div className="side-user">
            <span className={`crm-dot ${status ? "" : "off"}`} />
            <div>
              <b>{agent.name}</b>
              <small>{status ? "Online" : "Connecting..."}</small>
            </div>
          </div>
          <BorderGlow className="nav-glow" backgroundColor="#0a0a0c" borderRadius={14} glowColor="277 75 66" colors={["#ac58e9", "#7c3aed", "#e0b3ff"]} fillOpacity={0.3} glowRadius={16} edgeSensitivity={20}>
            <button className="side-logout" onClick={onLogout}>Log out</button>
            </BorderGlow>
        </div>
      </aside>

      <main className="main">
        {title && (
          <div className="crm-head">
            <div>
              {eyebrow && <small>{eyebrow}</small>}
              <h1>{title}</h1>
            </div>
            {right}
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
