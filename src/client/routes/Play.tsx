import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type { Socket } from "socket.io-client";
import { safeGet, safeSet, useRemaining, useWakeLock } from "../hooks";
import { useGame } from "../socket";
import type { Ack, Emit, GameState, Me, QuestionView } from "../types";
import {
  ConnectionBanner,
  CountdownRing,
  LETTERS,
  Shape,
  displayAnswerKey,
  fmt,
  optionLabel,
} from "../ui";

const TOKEN_KEY = "partyTrivia.token";
const DRAFT_PREFIX = "partyTrivia.draft.";

type Session = "none" | "rejoining" | "joined" | "kicked";

// Rate limiting is worth retrying; any other rejection means the token is dead.
const TRANSIENT_REJOIN = /too many requests|try again/i;

export default function Play() {
  const [session, setSession] = useState<Session>(() =>
    safeGet(TOKEN_KEY) ? "rejoining" : "none",
  );
  const [notice, setNotice] = useState<string | null>(null);
  const joinedRef = useRef(false);
  const sawMeRef = useRef(false);
  // Bumped on every connect and on kick so late rejoin replies/retries from an older attempt are ignored.
  const attemptRef = useRef(0);

  const onConnect = (socket: Socket) => {
    const attempt = ++attemptRef.current;
    sawMeRef.current = false;
    const token = safeGet(TOKEN_KEY);
    if (!token) {
      joinedRef.current = false;
      setSession("none");
      return;
    }
    setSession("rejoining");
    const retry = () =>
      window.setTimeout(
        () =>
          attempt === attemptRef.current &&
          socket.connected &&
          onConnect(socket),
        1500,
      );
    socket
      .timeout(8000)
      .emit(
        "rejoin",
        { token },
        (err: Error | null, res?: Ack<{ playerId: string; token: string }>) => {
          if (attempt !== attemptRef.current) return;
          if (err || (res && !res.ok && TRANSIENT_REJOIN.test(res.error))) {
            // No reply or rate limited: keep the token and retry (a dropped socket retries via the next connect).
            retry();
            return;
          }
          if (res?.ok) {
            if (res.token) safeSet(TOKEN_KEY, res.token);
            joinedRef.current = true;
            setSession("joined");
          } else {
            safeSet(TOKEN_KEY, null);
            joinedRef.current = false;
            setSession("none");
            setNotice(
              res?.error
                ? `${res.error}. Join again below.`
                : "Your session expired. Join again below.",
            );
          }
        },
      );
  };

  // The server sends `kicked` and then drops the socket, so stay on the removed screen until the player asks to rejoin.
  const onKicked = () => {
    attemptRef.current++;
    sawMeRef.current = false;
    joinedRef.current = false;
    safeSet(TOKEN_KEY, null);
    setSession("kicked");
    setNotice("You were removed from the game.");
  };

  const { state, conn, offset, emit, reconnect } = useGame(
    "player",
    null,
    onConnect,
    onKicked,
  );
  const remaining = useRemaining(state, offset);
  useWakeLock(session === "joined");

  // Fallback if `kicked` never arrives: joined and already seen ourselves on this connection, then `me` vanishes.
  // Snapshots sent before the rejoin landed never carry `me`, so they can't trigger this.
  useEffect(() => {
    if (!state) return;
    if (state.me) sawMeRef.current = true;
    else if (sawMeRef.current && joinedRef.current && session === "joined")
      onKicked();
  }, [state, session]);

  const onJoined = (token: string) => {
    safeSet(TOKEN_KEY, token);
    joinedRef.current = true;
    setNotice(null);
    setSession("joined");
  };

  const me = session === "joined" ? state?.me : undefined;

  return (
    <div className="play">
      <ConnectionBanner
        conn={conn}
        onReconnect={session === "kicked" ? undefined : reconnect}
        error={state?.error}
      />
      <header className="play-head">
        <span className="play-brand">{state?.title ?? "Party Trivia"}</span>
        {me && (
          <span className="play-me">
            {me.nickname} · <strong>{fmt(me.score)}</strong>
          </span>
        )}
      </header>
      <main className="play-main">
        {session === "kicked" ? (
          <Centered
            title="You were removed"
            sub="The host removed you from this game."
          >
            <button
              className="btn btn-primary btn-big"
              onClick={reconnect}
              disabled={conn.status === "connecting"}
            >
              Join again
            </button>
          </Centered>
        ) : !state || session === "rejoining" ? (
          <Centered
            title={session === "rejoining" ? "Rejoining…" : "Connecting…"}
          />
        ) : !me ? (
          <JoinForm
            emit={emit}
            onJoined={onJoined}
            notice={notice}
            state={state}
          />
        ) : (
          <PlayerPhase
            state={state}
            me={me}
            emit={emit}
            remaining={remaining}
          />
        )}
      </main>
    </div>
  );
}

function Centered({
  title,
  sub,
  children,
  tone,
}: {
  title: string;
  sub?: string;
  children?: ReactNode;
  tone?: string;
}) {
  return (
    <section className={`play-center pop-in ${tone ?? ""}`}>
      <h1 className="play-title">{title}</h1>
      {sub && <p className="play-sub">{sub}</p>}
      {children}
    </section>
  );
}

function JoinForm({
  emit,
  onJoined,
  notice,
  state,
}: {
  emit: Emit;
  onJoined: (token: string) => void;
  notice: string | null;
  state: GameState;
}) {
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const name = nickname.trim();
  const valid = name.length >= 1 && name.length <= 16;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    const res = await emit<{ playerId: string; token: string }>("join", {
      nickname: name,
    });
    setBusy(false);
    if (res.ok) onJoined(res.token);
    else setError(res.error);
  };

  return (
    <form className="play-center join pop-in" onSubmit={submit}>
      <h1 className="play-title">Join the game</h1>
      {state.phase === "final" ? (
        <p className="play-sub">
          This game has finished, but you can still join in case it restarts.
        </p>
      ) : state.phase !== "lobby" ? (
        <p className="play-sub">
          Game in progress — you’ll jump in at the next question.
        </p>
      ) : null}
      {notice && <p className="notice">{notice}</p>}
      <label className="sr-only" htmlFor="nickname">
        Nickname
      </label>
      <input
        id="nickname"
        className="input input-big"
        value={nickname}
        onChange={(e) => setNickname(e.target.value)}
        maxLength={16}
        placeholder="Your nickname"
        autoComplete="nickname"
        autoCapitalize="words"
        enterKeyHint="go"
        autoFocus
      />
      <div className="counter">{name.length}/16</div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button
        className="btn btn-primary btn-block btn-big"
        disabled={!valid || busy}
      >
        {busy ? "Joining…" : "Let’s go"}
      </button>
    </form>
  );
}

function PlayerPhase({
  state,
  me,
  emit,
  remaining,
}: {
  state: GameState;
  me: Me;
  emit: Emit;
  remaining: number | null;
}) {
  const q = state.question;
  switch (state.phase) {
    case "lobby":
      return <Centered title="You’re in!" sub="Watch the big screen." />;
    case "roundIntro":
      return (
        <Centered
          title={state.roundTitle}
          sub={`Round ${state.roundIdx + 1} is coming up`}
        />
      );
    case "question":
    case "paused":
      if (!q) return null;
      if (!me.eligible)
        return (
          <Centered
            title="Hang tight"
            sub="You’ll join from the next question."
          />
        );
      if (me.answer) return <Locked q={q} me={me} />;
      return (
        <AnswerInput
          key={q.id}
          q={q}
          emit={emit}
          remaining={remaining}
          paused={state.phase === "paused"}
        />
      );
    case "grading":
      return me.answer ? (
        <Locked q={q} me={me} title="Judges are deciding…" />
      ) : (
        <Centered
          title="Judges are deciding…"
          sub="No answer from you this time."
        />
      );
    case "reveal":
      return <Result state={state} me={me} />;
    case "leaderboard":
      return (
        <Centered
          title={me.rank ? `#${me.rank}` : "—"}
          sub={`of ${state.leaderboard.length} · ${fmt(me.score)} pts`}
          tone="rank"
        >
          <p className="play-sub muted">Look up for the leaderboard</p>
        </Centered>
      );
    case "final":
      return (
        <Centered
          title={
            me.rank === 1
              ? "Champion!"
              : me.rank
                ? `You finished #${me.rank}`
                : "Game over"
          }
          sub={`${fmt(me.score)} points · ${state.leaderboard.length} players`}
          tone={me.rank && me.rank <= 3 ? "podium" : "rank"}
        >
          <p className="play-sub muted">Thanks for playing!</p>
        </Centered>
      );
  }
}

function answerText(q: QuestionView | null, me: Me): string {
  const a = me.answer;
  if (!a) return "";
  if (a.text != null) return a.text;
  if (typeof a.choice === "boolean") return a.choice ? "True" : "False";
  if (typeof a.choice === "number")
    return `${LETTERS[a.choice]} · ${q?.options?.[a.choice] ?? ""}`;
  return "";
}

function Locked({
  q,
  me,
  title,
}: {
  q: QuestionView | null;
  me: Me;
  title?: string;
}) {
  const a = me.answer;
  const idx =
    typeof a?.choice === "boolean"
      ? a.choice
        ? 0
        : 1
      : typeof a?.choice === "number"
        ? a.choice
        : -1;
  const isText = a?.text != null;
  return (
    <Centered
      title={title ?? (isText ? "Sent!" : "Locked in!")}
      sub={title ? undefined : "Eyes on the big screen."}
    >
      <div className={`locked ${idx >= 0 ? `opt-${idx}` : ""}`}>
        {idx >= 0 && <Shape index={idx} size={36} />}
        <span className={isText ? "locked-text" : ""}>{answerText(q, me)}</span>
      </div>
    </Centered>
  );
}

function AnswerInput({
  q,
  emit,
  remaining,
  paused,
}: {
  q: QuestionView;
  emit: Emit;
  remaining: number | null;
  paused: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(null);

  const send = async (
    payload: { choice: number | boolean } | { text: string },
  ) => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    const res = await emit("answer", { questionId: q.id, ...payload });
    setBusy(false);
    if (!res.ok) setError(res.error);
    return res.ok;
  };

  const timeUp = remaining != null && remaining <= 0 && !paused;
  const disabled = busy || paused || timeUp;

  return (
    <section className="answer pop-in">
      <div className="answer-head">
        <p className="answer-prompt">{q.prompt}</p>
        {remaining != null && (
          <CountdownRing
            ms={remaining}
            totalMs={q.timeLimitSec * 1000}
            size={64}
            paused={paused}
          />
        )}
      </div>
      {paused && <p className="notice">Paused — hold on.</p>}
      {timeUp && <p className="notice">Time’s up!</p>}
      {q.options ? (
        <div className={`choices n${q.options.length}`}>
          {q.options.map((opt, i) => (
            <button
              key={i}
              className={`choice opt-${i} ${picked === i ? "picked" : ""}`}
              disabled={disabled}
              aria-label={`${optionLabel(i)}: ${opt}`}
              onClick={async () => {
                setPicked(i);
                const ok = await send({
                  choice: q.type === "tf" ? i === 0 : i,
                });
                if (!ok) setPicked(null);
              }}
            >
              <Shape index={i} size={40} />
              <span className="choice-letter">{LETTERS[i]}</span>
              <span className="choice-text">{opt}</span>
            </button>
          ))}
        </div>
      ) : (
        <TextAnswer
          q={q}
          disabled={disabled}
          busy={busy}
          onSend={(text) => send({ text })}
        />
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function TextAnswer({
  q,
  disabled,
  busy,
  onSend,
}: {
  q: QuestionView;
  disabled: boolean;
  busy: boolean;
  onSend: (text: string) => Promise<boolean>;
}) {
  const draftKey = DRAFT_PREFIX + q.id;
  const max = q.maxChars ?? (q.type === "short" ? 40 : 300);
  const [text, setText] = useState(() => safeGet(draftKey) ?? "");

  // Drafts only matter for the open question; clear leftovers from earlier ones.
  useEffect(() => {
    try {
      for (let i = window.localStorage.length - 1; i >= 0; i--) {
        const k = window.localStorage.key(i);
        if (k?.startsWith(DRAFT_PREFIX) && k !== draftKey)
          window.localStorage.removeItem(k);
      }
    } catch {
      // Storage unavailable.
    }
  }, [draftKey]);

  const update = (value: string) => {
    const next = value.slice(0, max);
    setText(next);
    safeSet(draftKey, next || null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || disabled) return;
    if (await onSend(text)) safeSet(draftKey, null);
  };

  const common = {
    id: "answer",
    value: text,
    maxLength: max,
    autoComplete: "off",
    autoFocus: true,
  } as const;
  return (
    <form className="text-answer" onSubmit={submit}>
      <label className="sr-only" htmlFor="answer">
        Your answer
      </label>
      {q.type === "free" ? (
        <textarea
          {...common}
          className="input input-big textarea"
          rows={5}
          placeholder="Write your answer…"
          onChange={(e) => update(e.target.value)}
        />
      ) : (
        <input
          {...common}
          className="input input-big"
          placeholder="Your answer"
          enterKeyHint="send"
          onChange={(e) => update(e.target.value)}
        />
      )}
      <div className={`counter ${text.length >= max ? "at-max" : ""}`}>
        {text.length}/{max}
      </div>
      <button
        className="btn btn-primary btn-block btn-big"
        disabled={disabled || !text.trim()}
      >
        {busy ? "Sending…" : "Send"}
      </button>
    </form>
  );
}

function Result({ state, me }: { state: GameState; me: Me }) {
  const a = me.answer;
  const q = state.question;
  const grade = a?.grade;
  const tone =
    grade === "correct" ? "good" : grade === "partial" ? "partial" : "bad";
  const title = !a
    ? "No answer"
    : grade === "correct"
      ? "Correct!"
      : grade === "partial"
        ? "Partly right"
        : "Not quite";
  return (
    <section className={`result result-${tone} pop-in`}>
      <div className="result-icon" aria-hidden="true">
        {grade === "correct" ? "✓" : grade === "partial" ? "½" : "✗"}
      </div>
      <h1 className="play-title">{title}</h1>
      <p className="result-points">+{fmt(a?.points ?? 0)}</p>
      {me.rank && (
        <p className="play-sub">
          You’re <strong>#{me.rank}</strong> of {state.leaderboard.length}
        </p>
      )}
      {state.answerKey != null && (
        <p className="result-key">
          Answer: <strong>{displayAnswerKey(q, state.answerKey)}</strong>
        </p>
      )}
    </section>
  );
}
