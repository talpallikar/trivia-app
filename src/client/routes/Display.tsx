import { useRankBaseline, useRemaining, useWakeLock } from "../hooks";
import { urlKey, useGame } from "../socket";
import type { GameState } from "../types";
import {
  ConnectionBanner,
  CountdownRing,
  Leaderboard,
  LETTERS,
  Podium,
  ProgressBar,
  QrCode,
  Shape,
  correctIndex,
  displayAnswerKey,
  fmt,
  isTextQuestion,
  optionLabel,
  shortUrl,
} from "../ui";

export default function Display() {
  const { state, conn, offset, reconnect } = useGame("display", urlKey());
  const remaining = useRemaining(state, offset);
  const baseline = useRankBaseline(state);
  useWakeLock(true);

  return (
    <div className="display">
      <ConnectionBanner
        conn={conn}
        onReconnect={reconnect}
        error={state?.error}
      />
      {!state ? (
        <div className="display-center">
          <h1 className="display-title">Party Trivia</h1>
          <p className="display-sub muted">Waiting for the game server…</p>
        </div>
      ) : (
        <>
          <header className="display-head">
            <span className="display-brand">{state.title}</span>
            {state.phase !== "lobby" && state.phase !== "final" && (
              <span className="display-meta">
                {state.roundTitle} · Question {state.questionNumber} of{" "}
                {state.totalQuestions}
              </span>
            )}
          </header>
          <Stage state={state} remaining={remaining} baseline={baseline} />
        </>
      )}
    </div>
  );
}

function Stage({
  state,
  remaining,
  baseline,
}: {
  state: GameState;
  remaining: number | null;
  baseline: Map<string, number>;
}) {
  const q = state.question;
  switch (state.phase) {
    case "lobby":
      return <Lobby state={state} />;
    case "roundIntro":
      return (
        <div className="display-center pop-in" key={`round-${state.roundIdx}`}>
          <p className="eyebrow">Round {state.roundIdx + 1}</p>
          <h1 className="display-title">{state.roundTitle}</h1>
          <p className="display-sub muted">Get your phones ready</p>
        </div>
      );
    case "question":
    case "paused":
      if (!q) return null;
      return (
        <div className="display-question" key={q.id}>
          <div className="display-q-top">
            <h1
              className={`display-prompt ${q.prompt.length > 110 ? "long" : ""}`}
            >
              {q.prompt}
            </h1>
            <div className="display-q-side">
              {remaining != null && (
                <CountdownRing
                  ms={remaining}
                  totalMs={q.timeLimitSec * 1000}
                  size={200}
                  paused={state.phase === "paused"}
                />
              )}
              <div className="answered">
                <strong>{state.answerCount}</strong>
                <span> / {state.eligibleCount} answered</span>
              </div>
            </div>
          </div>
          {q.image && <img className="display-image" src={q.image} alt="" />}
          {q.options ? (
            <div className={`display-options n${q.options.length}`}>
              {q.options.map((opt, i) => (
                <div
                  key={i}
                  className={`option opt-${i}`}
                  aria-label={optionLabel(i)}
                >
                  <Shape index={i} size={52} />
                  <span className="option-letter">{LETTERS[i]}</span>
                  <span className="option-text">{opt}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="display-hint">
              {q.type === "free"
                ? "Write your answer on your phone."
                : "Type your answer on your phone."}{" "}
              Hit <strong>Send</strong> before time runs out — unsent drafts
              don’t count.
            </p>
          )}
          {state.phase === "paused" && (
            <div className="display-paused">
              <span>Paused</span>
            </div>
          )}
        </div>
      );
    case "grading":
      return (
        <div className="display-center pop-in">
          <p className="eyebrow">Question {state.questionNumber}</p>
          <h1 className="display-title">Judging in progress…</h1>
          <div className="display-grading">
            <ProgressBar
              value={state.grading.graded}
              total={state.grading.total}
              label="Grading progress"
            />
            <p className="display-sub">
              {state.grading.graded} of {state.grading.total} graded
            </p>
          </div>
        </div>
      );
    case "reveal":
      return <Reveal state={state} />;
    case "leaderboard":
      return (
        <div className="display-board pop-in">
          <h1 className="display-heading">Leaderboard</h1>
          <Leaderboard entries={state.leaderboard} baseline={baseline} big />
        </div>
      );
    case "final":
      return (
        <div className="display-final pop-in">
          <h1 className="display-heading">Final results</h1>
          <Podium entries={state.leaderboard} />
          {state.leaderboard.length > 3 && (
            <ol className="final-rest" start={4}>
              {state.leaderboard.slice(3).map((e) => (
                <li key={e.id}>
                  <span className="board-rank">{e.rank}</span>
                  <span className="board-name">{e.nickname}</span>
                  <span className="board-score">{fmt(e.score)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      );
  }
}

function Lobby({ state }: { state: GameState }) {
  const players = state.players;
  return (
    <div className="display-lobby">
      <div className="lobby-join">
        {state.joinUrl ? (
          <QrCode text={state.joinUrl} size={380} />
        ) : (
          <div className="qr" />
        )}
        <p className="lobby-url">{shortUrl(state.joinUrl)}</p>
        <p className="muted lobby-sub">Scan to join — no app needed</p>
      </div>
      <div className="lobby-players">
        <h1 className="display-heading">
          {players.length} {players.length === 1 ? "player" : "players"}
        </h1>
        {players.length === 0 ? (
          <p className="display-sub muted">Waiting for the first brave soul…</p>
        ) : (
          <ul className="chips">
            {players.map((p) => (
              <li
                key={p.id}
                className={`chip pop-in ${p.connected ? "" : "offline"}`}
              >
                {p.nickname}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Reveal({ state }: { state: GameState }) {
  const q = state.question;
  if (!q) return null;
  const correct = correctIndex(q, state.answerKey);
  const dist = state.distribution ?? [];
  const max = Math.max(1, ...dist);
  const featured = state.featured ?? [];
  return (
    <div className="display-reveal pop-in" key={q.id}>
      <h2 className="display-prompt small">{q.prompt}</h2>
      <div className="reveal-key">
        <span className="eyebrow">Answer</span>
        <span className="reveal-key-text">
          {displayAnswerKey(q, state.answerKey)}
        </span>
      </div>
      {q.options && (
        <div className="dist">
          {q.options.map((opt, i) => (
            <div
              key={i}
              className={`dist-col opt-${i} ${i === correct ? "correct" : "dim"}`}
              aria-label={`${optionLabel(i)}: ${dist[i] ?? 0} answers`}
            >
              <span className="dist-count">{dist[i] ?? 0}</span>
              <div
                className="dist-bar"
                style={{ height: `${((dist[i] ?? 0) / max) * 100}%` }}
              />
              <div className="dist-label">
                <Shape index={i} size={30} />
                <span>{opt}</span>
                {i === correct && (
                  <span className="check" aria-label="correct">
                    ✓
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {isTextQuestion(q) && featured.length > 0 && (
        <div className="featured">
          {featured.slice(0, 3).map((f) => (
            <figure key={f.id} className="featured-card">
              <blockquote>“{f.text}”</blockquote>
              {f.nickname && <figcaption>— {f.nickname}</figcaption>}
            </figure>
          ))}
        </div>
      )}
      {isTextQuestion(q) && (
        <p className="display-sub muted">
          {state.grading.total}{" "}
          {state.grading.total === 1 ? "answer" : "answers"} received
        </p>
      )}
    </div>
  );
}
