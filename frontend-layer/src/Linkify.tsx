import type { WhatsAppInfo } from "./api";

export function Linkify({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer">{part}</a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

export function WhatsAppStatus({ message }: { message: WhatsAppInfo }) {
  if (message.status === "sent") return <div className="wa-status ok">Sent on WhatsApp to {message.to_number}</div>;
  if (message.status === "failed") return <div className="wa-status bad">Not delivered: {message.error}</div>;
  return <div className="wa-status">Not sent - WhatsApp keys not set</div>;
}
