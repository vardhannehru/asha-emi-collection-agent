import { useEffect } from "react";
import "./dialogs.css";

export default function Toast({ text, kind, onClose }: { text: string; kind: "ok" | "bad"; onClose: () => void }) {

  useEffect(() => {
    const timer = setTimeout(onClose, kind === "ok" ? 3500 : 7000);
    return () => clearTimeout(timer);
  }, [text, kind, onClose]);

  return (
    <div className={`toast-pop ${kind}`} role="status" aria-live="polite">
      <span>{text}</span>
      <button aria-label="Dismiss" onClick={onClose}>×</button>
    </div>
  );
}
