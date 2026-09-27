import { useEffect, useState, type ReactNode } from "react";
import { toDataURL } from "qrcode";
import type { Conn } from "./socket";
import type { GameState, QuestionView, RankEntry } from "./types";

export const LETTERS = ["A", "B", "C", "D", "E", "F"];
const SHAPE_NAMES = [
  "triangle",
  "diamond",
  "circle",
  "square",
  "star",
  "hexagon",
];

export const fmt = (n: number) => Math.round(n).toLocaleString();

/** Distinct silhouette per option so colour is never the only cue. */
export function Shape({ index, size = 28 }: { index: number; size?: number }) {
  const paths = [
    <polygon key="t" points="12,2 23,21 1,21" />,
    <polygon key="d" points="12,1 23,12 12,23 1,12" />,
    <circle key="c" cx="12" cy="12" r="10.5" />,
    <rect key="s" x="2" y="2" width="20" height="20" rx="2" />,
    <polygon
      key="st"
      points="12,1.5 14.9,8.6 22.5,9.2 16.7,14.1 18.5,21.6 12,17.6 5.5,21.6 7.3,14.1 1.5,9.2 9.1,8.6"
    />,
    <polygon key="h" points="12,1 21.5,6.5 21.5,17.5 12,23 2.5,17.5 2.5,6.5" />,
  ];
  return (
    <svg
      className="shape"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="currentColor"
    >
      {paths[index % paths.length]}
    </svg>
  );
}

export const optionLabel = (i: number) => `${LETTERS[i]}, ${SHAPE_NAMES[i]}`;

/** Index of the correct option once the answer key is revealed. */
export function correctIndex(
  q: QuestionView | null,
  answerKey?: string,
): number {
  if (!q || answerKey == null) return -1;
  if (q.type === "tf") return answerKey.toLowerCase() === "true" ? 0 : 1;
  if (q.type === "mc") return q.options?.indexOf(answerKey) ?? -1;
  return -1;
}

export function displayAnswerKey(q: QuestionView | null, answerKey?: string) {
  if (q?.type === "tf" && answerKey)
    return answerKey.toLowerCase() === "true" ? "True" : "False";
  return answerKey ?? "";
}

export function CountdownRing({
  ms,
  totalMs,
  size = 120,
  paused,
}: {
  ms: number;
  totalMs: number;
  size?: number;
  paused?: boolean;
}) {
  const r = 44;
  const c = 2 * Math.PI * r;
  const frac = totalMs > 0 ? Math.max(0, Math.min(1, ms / totalMs)) : 0;
  const secs = Math.ceil(ms / 1000);
  const urgent = !paused && secs <= 5;
  return (
    <div
      className={`ring ${urgent ? "urgent" : ""} ${paused ? "paused" : ""}`}
      style={{ width: size, height: size }}
      role="timer"
      aria-label={`${secs} seconds left`}
    >
      <svg viewBox="0 0 100 100" width={size} height={size}>
        <circle cx="50" cy="50" r={r} className="ring-track" />
        <circle
          cx="50"
          cy="50"
          r={r}
          className="ring-fill"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          transform="rotate(-90 50 50)"
        />
      </svg>
      <span className="ring-label" style={{ fontSize: size * 0.34 }}>
        {paused ? "❚❚" : secs}
      </span>
    </div>
  );
}

export function QrCode({ text, size = 320 }: { text: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!text) return;
    let live = true;
    toDataURL(text, {
      margin: 1,
      width: size * 2,
      errorCorrectionLevel: "M",
      color: { dark: "#1b1020", light: "#fff6ea" },
    })
      .then((url) => {
        if (!live) return;
        setSrc(url);
        setFailed(false);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [text, size]);
  if (failed)
    return (
      <div className="qr qr-failed" style={{ width: size, height: size }}>
        QR unavailable
      </div>
    );
  return src ? (
    <img
      className="qr"
      src={src}
      width={size}
      height={size}
      alt={`QR code for ${text}`}
    />
  ) : (
    <div className="qr" style={{ width: size, height: size }} />
  );
}

export const shortUrl = (url: string) =>
  url.replace(/^https?:\/\//, "").replace(/\/$/, "");

export function ConnectionBanner({
  conn,
  onReconnect,
  error,
}: {
  conn: Conn;
  onReconnect?: () => void;
  error?: string;
}) {
  if (conn.status === "connected" && !error) return null;
  let text: ReactNode;
  let tone = "warn";
  if (conn.status === "connected") {
    text = error;
    tone = "bad";
  } else if (conn.status === "connecting") text = "Connecting to the game…";
  else if (conn.status === "reconnecting")
    text = "Connection lost. Reconnecting…";
  else if (conn.status === "error")
    text = `Can’t reach the server (${conn.error}). Retrying…`;
  else {
    tone = "bad";
    text = conn.error ?? "Disconnected.";
  }
  return (
    <div className={`banner banner-${tone}`} role="status" aria-live="polite">
      <span>{text}</span>
      {conn.status === "closed" && onReconnect && (
        <button className="btn btn-small" onClick={onReconnect}>
          Reconnect
        </button>
      )}
    </div>
  );
}

export function Leaderboard({
  entries,
  highlightId,
  baseline,
  limit = 10,
  big,
}: {
  entries: RankEntry[];
  highlightId?: string;
  baseline?: Map<string, number>;
  limit?: number;
  big?: boolean;
}) {
  const shown = entries.slice(0, limit);
  if (!shown.length) return <p className="muted center">No players yet</p>;
  return (
    <ol className={`board ${big ? "board-big" : ""}`}>
      {shown.map((e, i) => {
        const before = baseline?.get(e.id);
        const move = before == null ? 0 : before - e.rank;
        return (
          <li
            key={e.id}
            className={`board-row ${e.id === highlightId ? "me" : ""}`}
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <span className="board-rank">{e.rank}</span>
            <span className="board-name">{e.nickname}</span>
            <span
              className={`board-move ${move > 0 ? "up" : move < 0 ? "down" : ""}`}
              aria-label={
                move > 0
                  ? `up ${move}`
                  : move < 0
                    ? `down ${-move}`
                    : "no change"
              }
            >
              {move > 0
                ? `▲${move}`
                : move < 0
                  ? `▼${-move}`
                  : baseline?.size
                    ? "–"
                    : ""}
            </span>
            <span className="board-score">{fmt(e.score)}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function Podium({
  entries,
  highlightId,
}: {
  entries: RankEntry[];
  highlightId?: string;
}) {
  const [first, second, third] = entries;
  const slot = (e: RankEntry | undefined, place: 1 | 2 | 3) => (
    <div
      className={`podium-slot place-${place} ${e && e.id === highlightId ? "me" : ""}`}
    >
      {e ? (
        <>
          <div className="podium-name">{e.nickname}</div>
          <div className="podium-score">{fmt(e.score)}</div>
        </>
      ) : (
        <div className="podium-name muted">—</div>
      )}
      <div className="podium-block">
        <span>{place}</span>
      </div>
    </div>
  );
  return (
    <div className="podium">
      {slot(second, 2)}
      {slot(first, 1)}
      {slot(third, 3)}
    </div>
  );
}

export function ProgressBar({
  value,
  total,
  label,
}: {
  value: number;
  total: number;
  label?: string;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div
      className="progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={value}
      aria-label={label}
    >
      <div className="progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function KeyGate({
  role,
  onKey,
}: {
  role: "host" | "grader";
  onKey: (key: string) => void;
}) {
  const [key, setKey] = useState("");
  return (
    <main className="page narrow">
      <form
        className="card stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (key.trim()) onKey(key.trim());
        }}
      >
        <h1 className="title">
          {role === "host" ? "Host controls" : "Grading"}
        </h1>
        <p className="muted">
          Enter the {role} key
          {role === "grader" ? " (the host key works too)" : ""} to continue.
        </p>
        <input
          className="input"
          type="password"
          autoComplete="off"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={`${role} key`}
          aria-label={`${role} key`}
          autoFocus
        />
        <button className="btn btn-primary btn-block" disabled={!key.trim()}>
          Continue
        </button>
      </form>
    </main>
  );
}

/** Puts the key into the URL so refreshes and bookmarks keep working. */
export function setUrlKey(key: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("key", key);
  window.history.replaceState(null, "", url);
}

export function phaseLabel(state: GameState): string {
  switch (state.phase) {
    case "lobby":
      return "Lobby";
    case "roundIntro":
      return `Round ${state.roundIdx + 1} intro`;
    case "question":
      return "Question open";
    case "paused":
      return "Paused";
    case "grading":
      return "Grading";
    case "reveal":
      return "Reveal";
    case "leaderboard":
      return "Leaderboard";
    case "final":
      return "Final results";
  }
}

export const isTextQuestion = (q: QuestionView | null) =>
  q?.type === "short" || q?.type === "free";
