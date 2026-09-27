import { useState, type ReactNode } from "react";
import GradeQueue from "../GradeQueue";
import { useRemaining, useWakeLock } from "../hooks";
import { urlKey, useGame } from "../socket";
import type {
  Emit,
  GameState,
  GradeQueue as Queue,
  PlayerView,
} from "../types";
import {
  ConnectionBanner,
  CountdownRing,
  KeyGate,
  Leaderboard,
  ProgressBar,
  QrCode,
  displayAnswerKey,
  fmt,
  isTextQuestion,
  phaseLabel,
  setUrlKey,
  shortUrl,
} from "../ui";

type Cmd =
  | "start"
  | "next"
  | "pause"
  | "resume"
  | "skip"
  | "end"
  | "forceReveal"
  | "restart";

export default function Host() {
  const [key, setKey] = useState(urlKey);
  if (!key) {
    const accept = (k: string) => {
      setUrlKey(k);
      setKey(k);
    };
    return <KeyGate role="host" onKey={accept} />;
  }
  return <HostPanel key={key} hostKey={key} />;
}

function HostPanel({ hostKey }: { hostKey: string }) {
  const { state, queue, conn, offset, emit, reconnect } = useGame(
    "host",
    hostKey,
  );
  const remaining = useRemaining(state, offset);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Cmd | null>(null);
  useWakeLock(true);

  const cmd = async (c: Cmd, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(c);
    setError(null);
    const res = await emit("host:cmd", { cmd: c });
    setBusy(null);
    if (!res.ok) setError(res.error);
  };

  return (
    <div className="page">
      <ConnectionBanner
        conn={conn}
        onReconnect={reconnect}
        error={state?.error}
      />
      <header className="bar">
        <span className="bar-title">Host</span>
        {state && <span className="bar-meta">{state.title}</span>}
      </header>
      {!state ? (
        <main className="narrow">
          <section className="card center">
            <p className="muted">
              {conn.status === "closed"
                ? "Check the host key and try again."
                : "Waiting for game state…"}
            </p>
          </section>
        </main>
      ) : (
        <main className="host-grid">
          <section className="card host-status">
            <div className="host-status-top">
              <div>
                <p className="eyebrow">{phaseLabel(state)}</p>
                <h1 className="title">
                  {state.phase === "lobby"
                    ? `${state.players.length} joined`
                    : state.phase === "final"
                      ? "Game over"
                      : `Q${state.questionNumber} of ${state.totalQuestions}`}
                </h1>
                {state.phase !== "lobby" && state.phase !== "final" && (
                  <p className="muted">{state.roundTitle}</p>
                )}
              </div>
              {remaining != null && state.question && (
                <CountdownRing
                  ms={remaining}
                  totalMs={state.question.timeLimitSec * 1000}
                  size={84}
                  paused={state.phase === "paused"}
                />
              )}
            </div>
            {state.question &&
              state.phase !== "lobby" &&
              state.phase !== "roundIntro" && (
                <p className="host-prompt">{state.question.prompt}</p>
              )}
            <PhaseDetail state={state} />
            <Controls state={state} busy={busy} cmd={cmd} />
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </section>

          {queue && isTextQuestion(state.question) && (
            <HostGrading
              state={state}
              queue={queue}
              emit={emit}
              hostKey={hostKey}
            />
          )}

          <Players state={state} emit={emit} />

          {(state.phase === "leaderboard" ||
            state.phase === "reveal" ||
            state.phase === "final") && (
            <section className="card">
              <h2 className="section-title">Leaderboard</h2>
              <Leaderboard entries={state.leaderboard} />
            </section>
          )}

          <Links state={state} hostKey={hostKey} />
        </main>
      )}
    </div>
  );
}

function PhaseDetail({ state }: { state: GameState }) {
  switch (state.phase) {
    case "question":
    case "paused":
      return (
        <div className="host-detail">
          <ProgressBar
            value={state.answerCount}
            total={state.eligibleCount}
            label="Answers received"
          />
          <p>
            <strong>{state.answerCount}</strong> / {state.eligibleCount}{" "}
            answered
          </p>
        </div>
      );
    case "grading":
      return (
        <div className="host-detail">
          <ProgressBar
            value={state.grading.graded}
            total={state.grading.total}
            label="Grading progress"
          />
          <p>
            <strong>{state.grading.graded}</strong> / {state.grading.total}{" "}
            graded
          </p>
        </div>
      );
    case "reveal":
      return (
        <div className="host-detail">
          <p>
            Answer:{" "}
            <strong>{displayAnswerKey(state.question, state.answerKey)}</strong>
          </p>
        </div>
      );
    default:
      return null;
  }
}

function Controls({
  state,
  busy,
  cmd,
}: {
  state: GameState;
  busy: Cmd | null;
  cmd: (c: Cmd, confirm?: string) => void;
}) {
  const b = (c: Cmd, label: string, cls = "", confirmText?: string) => (
    <button
      key={c}
      className={`btn ${cls}`}
      disabled={busy !== null}
      onClick={() => cmd(c, confirmText)}
    >
      {busy === c ? "…" : label}
    </button>
  );
  const endBtn = b(
    "end",
    "End game",
    "btn-danger",
    "End the game now and jump to final results?",
  );
  const skipBtn = b(
    "skip",
    "Skip question",
    "",
    "Skip this question? Any answers score 0.",
  );
  const ungraded = state.grading.total - state.grading.graded;
  const isLast = state.questionNumber >= state.totalQuestions;

  let main: ReactNode[] = [];
  switch (state.phase) {
    case "lobby":
      main = [
        b(
          "start",
          state.players.length
            ? `Start game (${state.players.length})`
            : "Start game",
          "btn-primary btn-big",
          state.players.length
            ? undefined
            : "Nobody has joined yet. Start anyway?",
        ),
      ];
      break;
    case "roundIntro":
      main = [b("next", "Open question", "btn-primary btn-big"), endBtn];
      break;
    case "question":
      main = [b("pause", "Pause", "btn-primary btn-big"), skipBtn, endBtn];
      break;
    case "paused":
      main = [b("resume", "Resume", "btn-primary btn-big"), skipBtn, endBtn];
      break;
    case "grading":
      main = [
        b(
          "forceReveal",
          ungraded ? `Force reveal (${ungraded} ungraded)` : "Reveal",
          "btn-primary btn-big",
          ungraded
            ? `${ungraded} ungraded ${ungraded === 1 ? "answer" : "answers"} will score 0. Reveal anyway?`
            : undefined,
        ),
        skipBtn,
        endBtn,
      ];
      break;
    case "reveal":
      main = [b("next", "Show leaderboard", "btn-primary btn-big"), endBtn];
      break;
    case "leaderboard":
      main = [
        b(
          "next",
          isLast ? "Final results" : "Next question",
          "btn-primary btn-big",
        ),
        endBtn,
      ];
      break;
    case "final":
      main = [
        b(
          "restart",
          "Restart game",
          "btn-danger",
          "Restart from the lobby? All scores reset to 0 (players stay joined).",
        ),
      ];
      break;
  }
  return <div className="controls">{main}</div>;
}

function HostGrading({
  state,
  queue,
  emit,
  hostKey,
}: {
  state: GameState;
  queue: Queue;
  emit: Emit;
  hostKey: string;
}) {
  const [open, setOpen] = useState(false);
  const grading = state.phase === "grading";
  return (
    <section className="card">
      <div className="section-head">
        <h2 className="section-title">
          {grading ? "Grading" : "Regrade answers"}
        </h2>
        <a
          className="btn btn-small"
          href={`/grade?key=${encodeURIComponent(hostKey)}`}
          target="_blank"
          rel="noreferrer"
        >
          Open grader
        </a>
      </div>
      <p className="muted small">
        Shows raw player answers — don’t open this on the projector.
      </p>
      <button
        className="btn btn-ghost btn-block"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open
          ? "Hide answers"
          : `Show answers (${queue.groups.reduce((n, g) => n + g.count, 0)})`}
      </button>
      {open && (
        <GradeQueue
          queue={queue}
          emit={emit}
          phase={state.phase}
          canSubmit={false}
        />
      )}
    </section>
  );
}

function Players({ state, emit }: { state: GameState; emit: Emit }) {
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const ranks = new Map(state.leaderboard.map((e) => [e.id, e.rank]));
  const players = [...state.players].sort(
    (a, b) => (ranks.get(a.id) ?? 999) - (ranks.get(b.id) ?? 999),
  );
  const online = players.filter((p) => p.connected).length;

  const adjust = async (payload: object) => {
    setError(null);
    const res = await emit("host:adjust", payload);
    if (!res.ok) setError(res.error);
    return res.ok;
  };

  return (
    <section className="card">
      <div className="section-head">
        <h2 className="section-title">Players</h2>
        <span className="muted small">
          {online} online · {players.length} total
        </span>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {players.length === 0 ? (
        <p className="muted">No one has joined yet.</p>
      ) : (
        <ul className="player-list">
          {players.map((p) => (
            <PlayerRow
              key={p.id}
              player={p}
              rank={ranks.get(p.id)}
              open={editing === p.id}
              onToggle={() => setEditing((cur) => (cur === p.id ? null : p.id))}
              onAdjust={(delta) => adjust({ playerId: p.id, delta })}
              onKick={() =>
                window.confirm(
                  `Kick ${p.nickname}? They’ll be removed from the game.`,
                ) && adjust({ kick: p.id })
              }
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function PlayerRow({
  player,
  rank,
  open,
  onToggle,
  onAdjust,
  onKick,
}: {
  player: PlayerView;
  rank?: number;
  open: boolean;
  onToggle: () => void;
  onAdjust: (delta: number) => Promise<boolean>;
  onKick: () => void;
}) {
  const [custom, setCustom] = useState("");
  const delta = Number(custom);
  const validCustom =
    custom.trim() !== "" && Number.isInteger(delta) && delta !== 0;
  return (
    <li className={`player-row ${open ? "open" : ""}`}>
      <button className="player-main" onClick={onToggle} aria-expanded={open}>
        <span
          className={`dot ${player.connected ? "on" : "off"}`}
          aria-label={player.connected ? "online" : "offline"}
        />
        <span className="player-rank">{rank ?? "–"}</span>
        <span className="player-name">{player.nickname}</span>
        <span className="player-score">{fmt(player.score)}</span>
      </button>
      {open && (
        <div className="player-tools">
          <div className="adjust-row">
            {[-500, -100, 100, 500].map((d) => (
              <button
                key={d}
                className="btn btn-small"
                onClick={() => onAdjust(d)}
              >
                {d > 0 ? `+${d}` : d}
              </button>
            ))}
          </div>
          <form
            className="adjust-row"
            onSubmit={async (e) => {
              e.preventDefault();
              if (validCustom && (await onAdjust(delta))) setCustom("");
            }}
          >
            <input
              className="input input-small"
              inputMode="numeric"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="± points"
              aria-label={`Custom score adjustment for ${player.nickname}`}
            />
            <button className="btn btn-small" disabled={!validCustom}>
              Apply
            </button>
            <button
              type="button"
              className="btn btn-small btn-danger"
              onClick={onKick}
            >
              Kick
            </button>
          </form>
        </div>
      )}
    </li>
  );
}

function Links({ state, hostKey }: { state: GameState; hostKey: string }) {
  const [graderKey, setGraderKey] = useState("");
  const [copied, setCopied] = useState(false);
  const origin = window.location.origin;
  const friendLink = graderKey.trim()
    ? `${origin}/grade?key=${encodeURIComponent(graderKey.trim())}`
    : "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(friendLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy this link", friendLink);
    }
  };

  return (
    <section className="card">
      <h2 className="section-title">Links</h2>
      <div className="links">
        {state.joinUrl && (
          <div className="link-join">
            <QrCode text={state.joinUrl} size={120} />
            <div>
              <p className="eyebrow">Players join at</p>
              <p className="link-url">{shortUrl(state.joinUrl)}</p>
            </div>
          </div>
        )}
        <div className="link-buttons">
          <a
            className="btn btn-small"
            href="/display"
            target="_blank"
            rel="noreferrer"
          >
            Open display
          </a>
          <a
            className="btn btn-small"
            href={`/grade?key=${encodeURIComponent(hostKey)}`}
            target="_blank"
            rel="noreferrer"
          >
            Grade on this device
          </a>
        </div>
        <div className="stack small-gap">
          <label className="eyebrow" htmlFor="grader-key">
            Grader link for a friend
          </label>
          <div className="adjust-row">
            <input
              id="grader-key"
              className="input input-small"
              type="password"
              autoComplete="off"
              value={graderKey}
              onChange={(e) => setGraderKey(e.target.value)}
              placeholder="Enter the grader key"
            />
            <button
              className="btn btn-small"
              disabled={!friendLink}
              onClick={copy}
            >
              {copied ? "Copied!" : "Copy link"}
            </button>
          </div>
          <p className="muted small">
            Uses the separate grader key so you never hand out the host key.
          </p>
        </div>
      </div>
    </section>
  );
}
