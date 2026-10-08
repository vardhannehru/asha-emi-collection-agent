// The Asha mark: a butterfly built from soft leaf-shaped wings. The solid inner wings sit over paler,
// offset copies. It takes its colour from the surrounding text colour.
function Wings() {
  return (
    <>
      <path d="M52 58C49 40 62 25 84 20C88 38 78 55 52 60Z" opacity=".22" transform="translate(-2 -4)" />
      <path d="M52 58C60 42 84 36 98 42C98 56 78 64 52 60Z" opacity=".22" />
      <path d="M52 60C68 60 84 68 80 82C76 94 56 92 52 76Z" opacity=".22" transform="translate(-1 6) scale(1.05)" />
      <path d="M52 60C68 62 74 72 68 84C62 92 50 88 51 78Z" opacity=".16" transform="translate(9 -3)" />
      <path d="M52 58C50 42 63 29 84 25C87 42 77 56 52 59Z" />
      <path d="M52 61C66 62 76 70 72 81C68 90 55 87 52 75Z" />
    </>
  );
}

export default function Logo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" fill="currentColor" aria-hidden="true">
      <Wings />
      <g transform="translate(100 0) scale(-1 1)">
        <Wings />
      </g>
    </svg>
  );
}
