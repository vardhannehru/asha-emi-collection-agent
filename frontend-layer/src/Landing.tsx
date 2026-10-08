import { useEffect, useRef, useState } from "react";
import "./landing.css";
import { post } from "./api";
import type { Agent } from "./api";
import Logo from "./Logo";

// Pictures for the login mosaic (one is picked at random each visit). To add more, drop the file into
// frontend-layer/public/login/ and add a line here. ar = width / height, bg = the picture's background colour.
const PICTURES = [{ src: "/login/portrait-1.jpg", ar: 1, bg: "#000" }];

// The mosaic on the right is a 4 x 4 grid: the picture is sliced across the cells, and three cells hold text tiles.
const CELLS = Array.from({ length: 16 }, (_, i) => i);
const STAT = 3;
const LOGO = 7;
const TEXT = 14; // spans two columns, so cell 15 is not drawn
const SKIP = 15;
const ART = CELLS.filter((i) => ![STAT, LOGO, TEXT, SKIP].includes(i));

// How long the puzzle takes to solve itself after a correct login, before the portal opens.
const SOLVE_MS = 1700;

// A random arrangement of the picture slices in which no slice is in its own place.
function scramble(): Map<number, number> {
  for (;;) {
    const slots = [...ART];
    for (let i = slots.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }
    if (slots.every((slot, i) => slot !== ART[i])) return new Map(ART.map((cell, i) => [cell, slots[i]]));
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The login page and the front door in one. The picture on the right starts as a scrambled puzzle; a correct login
// slides every piece into place, then a black portal opens from the button and the CRM appears.
export default function Landing({ onSignedIn }: { onSignedIn: (agent: Agent) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [solved, setSolved] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const mosaic = useRef<HTMLElement>(null);
  const signedIn = useRef<Agent | null>(null);
  const finished = useRef(false);
  const [picture] = useState(() => PICTURES[Math.floor(Math.random() * PICTURES.length)]);
  const [places] = useState(scramble);

  function finish() {
    if (finished.current || !signedIn.current) return;
    finished.current = true;
    onSignedIn(signedIn.current);
  }

  // Solve the puzzle (when it is visible), then open the portal from the button.
  async function succeed(agent: Agent) {
    signedIn.current = agent;
    if (mosaic.current && getComputedStyle(mosaic.current).display !== "none") {
      setSolved(true);
      await sleep(SOLVE_MS);
    }
    const box = button.current?.getBoundingClientRect();
    setOrigin(box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : { x: window.innerWidth / 2, y: window.innerHeight / 2 });
  }

  function fail(message: string) {
    setError(message);
    setBusy(false);
    setShaking(true);
    setTimeout(() => setShaking(false), 500);
  }

  // The portal ends by itself; the timer is a fallback (e.g. when animations are switched off).
  useEffect(() => {
    if (!origin) return;
    const t = setTimeout(finish, 1100);
    return () => clearTimeout(t);
  }, [origin]);

  // Optional Shift+R shortcut. The credentials come from frontend-layer/.env.local (git-ignored); without them it does nothing.
  async function devLogin() {
    const username = import.meta.env.VITE_DEV_USER;
    const password = import.meta.env.VITE_DEV_PASS;
    if (!username || !password) return;
    setBusy(true);
    setError("");
    try {
      await succeed(await post<Agent>("/api/auth/login", { username, password }));
    } catch {
      fail("Developer login failed. Account doesn't exist yet.");
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.shiftKey && e.code === "KeyR" && !busy) {
        e.preventDefault();
        devLogin();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const agent = mode === "login"
        ? await post<Agent>("/api/auth/login", { username, password })
        : await post<Agent>("/api/auth/register", { name, username, password });
      await succeed(agent);
    } catch (err) {
      fail((err as Error).message);
    }
  }

  return (
    <main className="gate-page">
      <div className="gate-frame">
        <section className="gate-panel">
          <div className="gate-logo" role="img" aria-label="asha"><Logo /></div>

          <div className="gate-copy">
            <h1>AI agent to collect EMIs</h1>
            <p>Then I follow up on WhatsApp with a payment link, and stop the moment they pay.</p>
          </div>

          <form className="gate-form" onSubmit={submit}>
            {mode === "register" && (
              <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Your name" aria-label="Your name" autoComplete="name" />
            )}
            <input value={username} onChange={(e) => setUsername(e.target.value)} required placeholder="Username" aria-label="Username" autoComplete="username" />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === "register" ? 6 : undefined}
              placeholder={mode === "register" ? "Password (at least 6 characters)" : "Password"}
              aria-label="Password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
            {error && <p className="gate-error" role="alert">{error}</p>}
            <button className="gate-submit" type="submit" ref={button} disabled={busy}>
              <span>{solved ? "Welcome" : busy ? "Please wait..." : mode === "login" ? "Log in" : "Create account"}</span>
              <i aria-hidden="true">↗</i>
            </button>
          </form>

          <p className="gate-switch">
            {mode === "login" ? "New here?" : "Already have an account?"}{" "}
            <button type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
              {mode === "login" ? "Create an account" : "Log in"}
            </button>
          </p>
        </section>

        <section
          ref={mosaic}
          className={`mosaic${solved ? " solved" : ""}${shaking ? " shaking" : ""}`}
          aria-hidden="true"
          style={{ "--art": `url(${picture.src})`, "--ar": picture.ar, "--art-bg": picture.bg } as React.CSSProperties}
        >
          {CELLS.map((i) => {
            if (i === SKIP) return null;
            const col = i % 4;
            const row = Math.floor(i / 4);
            const style = { "--col": col, "--row": row, "--i": i } as React.CSSProperties;
            if (i === STAT) return <div key={i} className="cell tile-stat" style={style}><b>AI</b><span>Collections agent</span></div>;
            if (i === LOGO) return <div key={i} className="cell tile-logo" style={style}><Logo /></div>;
            if (i === TEXT) {
              return (
                <div key={i} className="cell tile-text" style={style}>
                  <b>AI Collections Assistant</b>
                  <span>Calls overdue borrowers, then follows up on WhatsApp.</span>
                </div>
              );
            }
            // This slice belongs in cell i but is shown in another cell until the login is correct.
            const at = places.get(i) ?? i;
            const puzzle = { ...style, "--dx": (at % 4) - col, "--dy": Math.floor(at / 4) - row } as React.CSSProperties;
            return <div key={i} className="cell art" style={puzzle} />;
          })}
        </section>
      </div>

      {origin && (
        <div
          className="portal"
          style={{ "--px": `${origin.x}px`, "--py": `${origin.y}px` } as React.CSSProperties}
          onAnimationEnd={finish}
        />
      )}
    </main>
  );
}
