import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type {
  Emit,
  Grade,
  GradeQueue as Queue,
  Phase,
  QueueGroup,
} from "./types";

type SetGrade = Exclude<Grade, "ungraded">;
const GRADE_LABEL: Record<Grade | "mixed", string> = {
  correct: "Correct",
  partial: "Partial",
  wrong: "Wrong",
  ungraded: "Ungraded",
  mixed: "Mixed",
};

export default function GradeQueue({
  queue,
  emit,
  phase,
  canSubmit,
}: {
  queue: Queue;
  emit: Emit;
  phase?: Phase;
  canSubmit: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [showNames, setShowNames] = useState(false);
  const [showAuto, setShowAuto] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const run = async (tag: string, event: string, payload: unknown) => {
    setBusy((b) => new Set(b).add(tag));
    setError(null);
    const res = await emit(event, payload);
    setBusy((b) => {
      const next = new Set(b);
      next.delete(tag);
      return next;
    });
    if (!res.ok) setError(res.error);
    return res.ok;
  };

  const setGrade = (answerIds: string[], grade: SetGrade, tag: string) =>
    run(tag, "grade:set", { questionId: queue.questionId, answerIds, grade });
  const feature = (answerId: string, featured: boolean) =>
    run(`f:${answerId}`, "grade:feature", { answerId, featured });

  const total = queue.groups.reduce((n, g) => n + g.count, 0);
  // Trust the queue itself (nicknames present or not) so a reconnect can't leave the toggle out of sync.
  const namesOn =
    total > 0
      ? queue.groups.some((g) =>
          g.answers.some((a) => a.nickname !== undefined),
        )
      : showNames;

  const toggleNames = async () => {
    const show = !namesOn;
    if (await run("names", "grade:names", { show })) setShowNames(show);
  };

  const submit = async () => {
    const remaining = queue.remaining;
    if (
      remaining > 0 &&
      !window.confirm(
        `${remaining} ${remaining === 1 ? "answer is" : "answers are"} still ungraded and will be scored wrong. Submit anyway?`,
      )
    )
      return;
    setSubmitting(true);
    await run("submit", "grade:submit", {
      questionId: queue.questionId,
      ...(remaining > 0 ? { force: true } : {}),
    });
    setSubmitting(false);
  };

  const auto = queue.groups.filter((g) => g.suggested && g.grade === "correct");
  const manual = queue.groups.filter(
    (g) => !(g.suggested && g.grade === "correct"),
  );
  const grading = phase === undefined || phase === "grading";

  return (
    <div className="gq">
      <div className="gq-pinned">
        <p className="gq-prompt">{queue.prompt}</p>
        <p className="gq-key">
          <span className="eyebrow">Answer</span> {queue.answerKey}
        </p>
        <div className="gq-tools">
          <span className="muted">
            {total} {total === 1 ? "answer" : "answers"} · {queue.remaining}{" "}
            left
          </span>
          <button
            className={`btn btn-small ${namesOn ? "btn-on" : ""}`}
            onClick={toggleNames}
            disabled={busy.has("names")}
            aria-pressed={namesOn}
          >
            {namesOn ? "Hide names" : "Show names"}
          </button>
        </div>
        {!grading && (
          <p className="notice small">
            Regrading — changes update scores immediately.
          </p>
        )}
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {total === 0 && <p className="muted center">Nobody answered this one.</p>}

      <ul className="gq-list">
        {manual.map((g) => (
          <GroupCard
            key={g.normalized}
            group={g}
            allowPartial={queue.allowPartial}
            busy={busy}
            showNames={namesOn}
            onGrade={setGrade}
            onFeature={feature}
          />
        ))}
      </ul>

      {auto.length > 0 && (
        <div className="gq-auto">
          <button
            className="btn btn-ghost btn-block"
            onClick={() => setShowAuto((v) => !v)}
            aria-expanded={showAuto}
          >
            {showAuto ? "▾" : "▸"} Auto-matched correct (
            {auto.reduce((n, g) => n + g.count, 0)})
          </button>
          {showAuto && (
            <ul className="gq-list">
              {auto.map((g) => (
                <GroupCard
                  key={g.normalized}
                  group={g}
                  allowPartial={queue.allowPartial}
                  busy={busy}
                  showNames={namesOn}
                  onGrade={setGrade}
                  onFeature={feature}
                />
              ))}
            </ul>
          )}
        </div>
      )}

      {canSubmit && grading && (
        <div className="gq-submit">
          <button
            className="btn btn-primary btn-block btn-big"
            onClick={submit}
            disabled={submitting}
          >
            {submitting
              ? "Submitting…"
              : queue.remaining > 0
                ? `Submit & reveal (${queue.remaining} ungraded)`
                : "Submit & reveal"}
          </button>
        </div>
      )}
    </div>
  );
}

function GroupCard({
  group,
  allowPartial,
  busy,
  showNames,
  onGrade,
  onFeature,
}: {
  group: QueueGroup;
  allowPartial: boolean;
  busy: Set<string>;
  showNames: boolean;
  onGrade: (ids: string[], grade: SetGrade, tag: string) => Promise<boolean>;
  onFeature: (id: string, featured: boolean) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const tag = `g:${group.normalized}`;
  const isBusy = busy.has(tag);
  const grades: SetGrade[] = allowPartial
    ? ["correct", "partial", "wrong"]
    : ["correct", "wrong"];
  const single = group.count === 1 ? group.answers[0] : undefined;

  // Swipe right = correct, left = wrong. Only starts on the card body, not on buttons.
  const onPointerDown = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    const x = e.clientX - s.x;
    if (Math.abs(e.clientY - s.y) > Math.abs(x) && Math.abs(x) < 10) return;
    setDx(Math.max(-140, Math.min(140, x)));
  };
  const onPointerEnd = () => {
    if (!start.current) return;
    start.current = null;
    if (dx > 90) void onGrade(group.answerIds, "correct", tag);
    else if (dx < -90) void onGrade(group.answerIds, "wrong", tag);
    setDx(0);
  };
  // The browser took over the gesture (usually a vertical scroll): snap back without grading.
  const onPointerCancel = () => {
    start.current = null;
    setDx(0);
  };

  return (
    <li className={`gq-card grade-${group.grade} ${isBusy ? "busy" : ""}`}>
      <div
        className="gq-swipe-hint left"
        aria-hidden="true"
        style={{ opacity: dx > 0 ? dx / 90 : 0 }}
      >
        ✓
      </div>
      <div
        className="gq-swipe-hint right"
        aria-hidden="true"
        style={{ opacity: dx < 0 ? -dx / 90 : 0 }}
      >
        ✗
      </div>
      <div
        className="gq-card-body"
        style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerCancel}
      >
        <div className="gq-card-top">
          <p className="gq-text">
            {group.text || <em className="muted">(blank)</em>}
          </p>
          {group.count > 1 && <span className="badge">×{group.count}</span>}
          {single && (
            <StarButton
              featured={single.featured}
              disabled={busy.has(`f:${single.id}`)}
              onClick={() => onFeature(single.id, !single.featured)}
            />
          )}
        </div>
        <div className="gq-card-meta">
          <span className={`grade-chip chip-${group.grade}`}>
            {GRADE_LABEL[group.grade]}
          </span>
          {group.suggested && <span className="muted small">auto-matched</span>}
          {single && showNames && single.nickname && (
            <span className="muted small">— {single.nickname}</span>
          )}
          {group.count > 1 && (
            <button
              className="link-btn"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
            >
              {open ? "Hide" : "Show"} {group.count} answers
            </button>
          )}
        </div>
        <div className="grade-btns">
          {grades.map((g) => (
            <button
              key={g}
              className={`grade-btn gb-${g} ${group.grade === g ? "active" : ""}`}
              disabled={isBusy}
              aria-pressed={group.grade === g}
              onClick={() => onGrade(group.answerIds, g, tag)}
            >
              {g === "correct"
                ? "✓ Correct"
                : g === "partial"
                  ? "½ Partial"
                  : "✗ Wrong"}
            </button>
          ))}
        </div>
        {open && group.count > 1 && (
          <ul className="gq-answers">
            {group.answers.map((a) => (
              <li key={a.id}>
                <span className="gq-answer-text">
                  {a.text}
                  {showNames && a.nickname && (
                    <span className="muted small"> — {a.nickname}</span>
                  )}
                  {a.grade && a.grade !== group.grade && (
                    <span className={`grade-chip chip-${a.grade}`}>
                      {GRADE_LABEL[a.grade]}
                    </span>
                  )}
                </span>
                <span className="gq-answer-actions">
                  {grades.map((g) => (
                    <button
                      key={g}
                      className={`mini-btn gb-${g} ${a.grade === g ? "active" : ""}`}
                      disabled={busy.has(`a:${a.id}`)}
                      aria-pressed={a.grade === g}
                      aria-label={`Mark this answer ${g}`}
                      onClick={() => onGrade([a.id], g, `a:${a.id}`)}
                    >
                      {g === "correct" ? "✓" : g === "partial" ? "½" : "✗"}
                    </button>
                  ))}
                  <StarButton
                    featured={a.featured}
                    disabled={busy.has(`f:${a.id}`)}
                    onClick={() => onFeature(a.id, !a.featured)}
                  />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

function StarButton({
  featured,
  disabled,
  onClick,
}: {
  featured: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`star-btn ${featured ? "on" : ""}`}
      disabled={disabled}
      onClick={onClick}
      aria-pressed={featured}
      aria-label={featured ? "Remove from projector" : "Feature on projector"}
      title={featured ? "Featured on projector" : "Feature on projector"}
    >
      {featured ? "★" : "☆"}
    </button>
  );
}
