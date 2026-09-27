import { useState } from "react";
import GradeQueue from "../GradeQueue";
import { useWakeLock } from "../hooks";
import { urlKey, useGame } from "../socket";
import { ConnectionBanner, KeyGate, phaseLabel, setUrlKey } from "../ui";

export default function Grade() {
  const [key, setKey] = useState(urlKey);
  if (!key) {
    const accept = (k: string) => {
      setUrlKey(k);
      setKey(k);
    };
    return <KeyGate role="grader" onKey={accept} />;
  }
  return <Grader key={key} graderKey={key} />;
}

function Grader({ graderKey }: { graderKey: string }) {
  const { state, queue, conn, emit, reconnect } = useGame("grader", graderKey);
  useWakeLock(true);

  return (
    <div className="page">
      <ConnectionBanner
        conn={conn}
        onReconnect={reconnect}
        error={state?.error}
      />
      <header className="bar">
        <span className="bar-title">Grading</span>
        {state && (
          <span className="bar-meta">
            Q{state.questionNumber}/{state.totalQuestions} · {phaseLabel(state)}
          </span>
        )}
      </header>
      <main className="narrow">
        {queue ? (
          <GradeQueue
            queue={queue}
            emit={emit}
            phase={state?.phase}
            canSubmit
          />
        ) : (
          <section className="card center stack">
            <h1 className="title">Nothing to grade yet</h1>
            <p className="muted">
              {state?.phase === "question" &&
              state.question &&
              (state.question.type === "short" ||
                state.question.type === "free")
                ? `Answers are coming in (${state.answerCount}/${state.eligibleCount}). The queue opens when the question closes.`
                : "Typed answers appear here when a text question closes. Keep this page open."}
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
