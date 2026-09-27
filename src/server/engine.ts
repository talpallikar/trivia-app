import type { GameState as StateView, GradeQueue } from "../shared/protocol.js";
import { randomUUID } from "node:crypto";
import {
  type QuestionFile,
  type Question,
  isText,
  normalize,
} from "../shared/questions.js";
export type Phase =
  | "lobby"
  | "roundIntro"
  | "question"
  | "paused"
  | "grading"
  | "reveal"
  | "leaderboard"
  | "final";
export type Grade = "correct" | "partial" | "wrong" | "ungraded";
export type Player = {
  id: string;
  token: string;
  nickname: string;
  score: number;
  adjustment: number;
  connected: boolean;
  kicked: boolean;
};
export type Answer = {
  id: string;
  playerId: string;
  questionId: string;
  choice?: number | boolean;
  text?: string;
  normalized?: string;
  receivedAt: number;
  elapsedMs: number;
  grade: Grade;
  points: number;
  featured: boolean;
  gradedBy?: "auto" | "human";
};
export type State = {
  phase: Phase;
  roundIdx: number;
  questionIdx: number;
  version: number;
  players: Record<string, Player>;
  answers: Answer[];
  eligible: string[];
  deadline: number | null;
  remainingMs: number | null;
  elapsedMs: number;
  resumedAt: number | null;
};
function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
export class Engine {
  state: State;
  constructor(
    public file: QuestionFile,
    state?: State,
  ) {
    this.state = state ?? this.initial();
  }
  initial(): State {
    return {
      phase: "lobby",
      roundIdx: 0,
      questionIdx: 0,
      version: 0,
      players: {},
      answers: [],
      eligible: [],
      deadline: null,
      remainingMs: null,
      elapsedMs: 0,
      resumedAt: null,
    };
  }
  get q(): Question {
    return this.file.rounds[this.state.roundIdx].questions[
      this.state.questionIdx
    ];
  }
  get limit() {
    return (
      (this.q.timeLimitSec ??
        (isText(this.q)
          ? this.file.defaultTimeLimitSec.text
          : this.file.defaultTimeLimitSec.choice)) * 1000
    );
  }
  get answers() {
    return this.state.answers.filter((a) => a.questionId === this.q.id);
  }
  touch() {
    this.state.version++;
  }
  join(nickname: string) {
    assert(
      !Object.values(this.state.players).some(
        (p) =>
          !p.kicked &&
          p.nickname.toLocaleLowerCase() === nickname.toLocaleLowerCase(),
      ),
      "Nickname is already taken",
    );
    const p: Player = {
      id: randomUUID(),
      token: randomUUID(),
      nickname,
      score: 0,
      adjustment: 0,
      connected: true,
      kicked: false,
    };
    this.state.players[p.id] = p;
    this.touch();
    return p;
  }
  rejoin(token: string) {
    const p = Object.values(this.state.players).find(
      (p) => p.token === token && !p.kicked,
    );
    assert(p, "Player session not found");
    p.connected = true;
    this.touch();
    return p;
  }
  open(now: number) {
    Object.assign(this.state, {
      phase: "question",
      eligible: Object.values(this.state.players)
        .filter((p) => p.connected && !p.kicked)
        .map((p) => p.id),
      deadline: now + this.limit,
      remainingMs: null,
      elapsedMs: 0,
      resumedAt: now,
    });
  }
  command(cmd: string, now: number) {
    const s = this.state;
    switch (cmd) {
      case "start":
        assert(s.phase === "lobby", "Game has already started");
        s.phase = "roundIntro";
        break;
      case "next":
        if (s.phase === "roundIntro") this.open(now);
        else if (s.phase === "reveal") s.phase = "leaderboard";
        else if (s.phase === "leaderboard") {
          if (
            s.questionIdx + 1 <
            this.file.rounds[s.roundIdx].questions.length
          ) {
            s.questionIdx++;
            this.open(now);
          } else if (s.roundIdx + 1 < this.file.rounds.length) {
            s.roundIdx++;
            s.questionIdx = 0;
            s.phase = "roundIntro";
          } else s.phase = "final";
        } else throw new Error("Cannot advance this phase");
        break;
      case "pause":
        assert(s.phase === "question", "No active question");
        assert(now < (s.deadline ?? 0), "Question has expired");
        s.remainingMs = Math.max(0, s.deadline! - now);
        s.elapsedMs += now - s.resumedAt!;
        s.deadline = null;
        s.resumedAt = null;
        s.phase = "paused";
        break;
      case "resume":
        assert(s.phase === "paused", "Game is not paused");
        s.deadline = now + s.remainingMs!;
        s.resumedAt = now;
        s.remainingMs = null;
        s.phase = "question";
        break;
      case "skip":
        assert(
          ["question", "paused", "grading"].includes(s.phase),
          "Cannot skip this phase",
        );
        for (const a of this.answers) {
          a.grade = "wrong";
          a.points = 0;
          a.featured = false;
        }
        s.phase = "reveal";
        s.deadline = null;
        this.recompute();
        break;
      case "forceReveal":
        assert(s.phase === "grading", "Not grading");
        this.finishGrading(true);
        break;
      case "end":
        if (["question", "paused", "grading"].includes(s.phase)) {
          for (const a of this.answers)
            if (a.grade === "ungraded") a.grade = "wrong";
          this.score();
        }
        s.phase = "final";
        s.deadline = null;
        break;
      case "restart": {
        const players = s.players;
        this.state = this.initial();
        this.state.version = s.version;
        this.state.players = players;
        for (const p of Object.values(players)) {
          p.score = 0;
          p.adjustment = 0;
        }
        break;
      }
      default:
        throw new Error("Unknown command");
    }
    this.touch();
  }
  answer(
    playerId: string,
    input: { questionId: string; choice?: number | boolean; text?: string },
    now: number,
  ) {
    const s = this.state;
    const p = s.players[playerId];
    assert(p && !p.kicked, "Join before answering");
    assert(input.questionId === this.q.id, "Wrong question");
    const existing = this.answers.find((a) => a.playerId === playerId);
    if (existing) return existing;
    assert(s.phase === "question", "Question is closed");
    assert(now <= s.deadline! + 300, "Answer arrived too late");
    assert(
      s.eligible.includes(playerId),
      "You can play from the next question",
    );
    const q = this.q;
    if (q.type === "mc")
      assert(
        Number.isInteger(input.choice) &&
          typeof input.choice === "number" &&
          input.choice >= 0 &&
          input.choice < q.options.length,
        "Choose an available option",
      );
    else if (q.type === "tf")
      assert(typeof input.choice === "boolean", "Choose true or false");
    else
      assert(
        typeof input.text === "string" &&
          input.text.trim().length > 0 &&
          input.text.length <= (q.type === "short" ? 40 : q.maxChars),
        "Answer is blank or too long",
      );
    const a: Answer = {
      id: randomUUID(),
      playerId,
      questionId: q.id,
      receivedAt: now,
      elapsedMs: Math.min(this.limit, s.elapsedMs + now - s.resumedAt!),
      grade: "ungraded",
      points: 0,
      featured: false,
      ...(isText(q)
        ? { text: input.text!, normalized: normalize(input.text!) }
        : { choice: input.choice }),
    };
    s.answers.push(a);
    if (s.eligible.every((id) => this.answers.some((a) => a.playerId === id)))
      this.close();
    this.touch();
    return a;
  }
  tick(now: number) {
    if (
      this.state.phase === "question" &&
      now >= (this.state.deadline ?? Infinity) + 300
    ) {
      this.close();
      this.touch();
      return true;
    }
    return false;
  }
  close() {
    this.state.deadline = null;
    for (const a of this.answers) {
      if (!isText(this.q)) {
        a.grade =
          a.choice === (this.q as { correct: number | boolean }).correct
            ? "correct"
            : "wrong";
        a.gradedBy = "auto";
      } else if (
        this.q.type === "short" &&
        this.q.acceptable?.some((t) => normalize(t) === a.normalized)
      ) {
        a.grade = "correct";
        a.gradedBy = "auto";
      }
    }
    this.state.phase = isText(this.q) ? "grading" : "reveal";
    this.score();
  }
  grade(ids: string[], grade: Exclude<Grade, "ungraded">, questionId: string) {
    assert(
      questionId === this.q.id &&
        isText(this.q) &&
        ["grading", "reveal", "leaderboard", "final"].includes(
          this.state.phase,
        ),
      "Question is not available for grading",
    );
    assert(
      grade !== "partial" || ("allowPartial" in this.q && this.q.allowPartial),
      "Partial credit is disabled",
    );
    assert(
      ids.length > 0 &&
        ids.every((id) => this.answers.some((a) => a.id === id)),
      "Unknown answer",
    );
    for (const a of this.answers)
      if (ids.includes(a.id)) {
        a.grade = grade;
        a.gradedBy = "human";
      }
    this.score();
    this.touch();
  }
  feature(id: string, featured: boolean) {
    assert(
      isText(this.q) &&
        ["grading", "reveal", "leaderboard", "final"].includes(
          this.state.phase,
        ),
      "Cannot feature answers now",
    );
    const a = this.answers.find((a) => a.id === id);
    assert(a, "Unknown answer");
    a.featured = featured;
    this.touch();
  }
  finishGrading(force = false) {
    assert(this.state.phase === "grading", "Not grading");
    assert(
      force || this.answers.every((a) => a.grade !== "ungraded"),
      "Answers still need grading",
    );
    for (const a of this.answers) if (a.grade === "ungraded") a.grade = "wrong";
    this.score();
    this.state.phase = "reveal";
    this.touch();
  }
  score() {
    for (const a of this.answers)
      a.points =
        a.grade === "correct"
          ? isText(this.q)
            ? this.q.points
            : Math.round(this.q.points * (1 - a.elapsedMs / (2 * this.limit)))
          : a.grade === "partial"
            ? Math.round(this.q.points / 2)
            : 0;
    this.recompute();
  }
  recompute() {
    for (const p of Object.values(this.state.players))
      p.score =
        p.adjustment +
        this.state.answers
          .filter((a) => a.playerId === p.id)
          .reduce((s, a) => s + a.points, 0);
  }
  adjust(id: string, delta: number) {
    const p = this.state.players[id];
    assert(p && !p.kicked, "Unknown player");
    p.adjustment += delta;
    this.recompute();
    this.touch();
  }
  kick(id: string) {
    const p = this.state.players[id];
    assert(p, "Unknown player");
    p.kicked = true;
    p.connected = false;
    this.state.eligible = this.state.eligible.filter((x) => x !== id);
    if (
      this.state.phase === "question" &&
      this.state.eligible.length &&
      this.state.eligible.every((id) =>
        this.answers.some((a) => a.playerId === id),
      )
    )
      this.close();
    this.touch();
  }
  ranking() {
    const times = (id: string) =>
      this.state.answers
        .filter((a) => a.playerId === id && a.choice !== undefined)
        .reduce((s, a) => s + a.elapsedMs, 0);
    return Object.values(this.state.players)
      .filter((p) => !p.kicked)
      .sort(
        (a, b) =>
          b.score - a.score ||
          times(a.id) - times(b.id) ||
          a.nickname.localeCompare(b.nickname),
      )
      .map((p, i) => ({
        id: p.id,
        nickname: p.nickname,
        score: p.score,
        rank: i + 1,
      }));
  }
  answerKey() {
    const q = this.q;
    return q.type === "mc"
      ? q.options[q.correct]
      : q.type === "tf"
        ? String(q.correct)
        : (q.answer ?? "Open response");
  }
  view(
    role: string,
    playerId: string | undefined,
    now: number,
    joinUrl: string,
    ranking = this.ranking(),
  ): StateView {
    const s = this.state,
      q = this.q;
    const revealed = ["reveal", "leaderboard", "final"].includes(s.phase);
    const visible = !["lobby", "roundIntro"].includes(s.phase);
    const own = this.answers.find((a) => a.playerId === playerId);
    const p =
      playerId && !s.players[playerId]?.kicked
        ? s.players[playerId]
        : undefined;
    return {
      version: s.version,
      serverNow: now,
      title: this.file.title,
      phase: s.phase,
      roundTitle: this.file.rounds[s.roundIdx].title,
      roundIdx: s.roundIdx,
      questionIdx: s.questionIdx,
      questionNumber:
        this.file.rounds
          .slice(0, s.roundIdx)
          .reduce((n, r) => n + r.questions.length, 0) +
        s.questionIdx +
        1,
      totalQuestions: this.file.rounds.reduce(
        (n, r) => n + r.questions.length,
        0,
      ),
      joinUrl,
      deadline: s.deadline,
      remainingMs: s.remainingMs,
      question: visible
        ? {
            id: q.id,
            type: q.type,
            prompt: q.prompt,
            image: q.image,
            options:
              q.type === "mc"
                ? q.options
                : q.type === "tf"
                  ? ["True", "False"]
                  : undefined,
            timeLimitSec: this.limit / 1000,
            points: q.points,
            maxChars:
              q.type === "short"
                ? 40
                : q.type === "free"
                  ? q.maxChars
                  : undefined,
            allowPartial: "allowPartial" in q ? q.allowPartial : false,
          }
        : null,
      players: Object.values(s.players)
        .filter((p) => !p.kicked)
        .map((p) => ({
          id: p.id,
          nickname: p.nickname,
          score: p.score,
          connected: p.connected,
        })),
      leaderboard: ranking,
      answerCount: this.answers.length,
      eligibleCount: s.eligible.length,
      grading: {
        total: this.answers.length,
        graded: this.answers.filter((a) => a.grade !== "ungraded").length,
      },
      ...(revealed
        ? {
            answerKey: this.answerKey(),
            distribution: isText(q)
              ? undefined
              : (q.type === "mc" ? q.options : [true, false]).map(
                  (_, i) =>
                    this.answers.filter(
                      (a) => a.choice === (q.type === "tf" ? i === 0 : i),
                    ).length,
                ),
            ...(role !== "player"
              ? {
                  featured: this.answers
                    .filter((a) => a.featured && !s.players[a.playerId]?.kicked)
                    .map((a) => ({
                      id: a.id,
                      text: a.text,
                      nickname: s.players[a.playerId]?.nickname,
                    })),
                }
              : {}),
          }
        : {}),
      ...(p
        ? {
            me: {
              id: p.id,
              nickname: p.nickname,
              score: p.score,
              rank: ranking.find((r) => r.id === p.id)?.rank,
              eligible: s.eligible.includes(p.id),
              answer: own
                ? {
                    id: own.id,
                    choice: own.choice,
                    text: own.text,
                    grade: revealed ? own.grade : "ungraded",
                    points: revealed ? own.points : 0,
                  }
                : undefined,
            },
          }
        : {}),
    };
  }
  queue(names = false): GradeQueue | null {
    if (
      !isText(this.q) ||
      !["grading", "reveal", "leaderboard", "final"].includes(this.state.phase)
    )
      return null;
    const groups = new Map<string, Answer[]>();
    for (const a of this.answers) {
      const key = a.normalized ?? "";
      groups.set(key, [...(groups.get(key) ?? []), a]);
    }
    return {
      questionId: this.q.id,
      prompt: this.q.prompt,
      answerKey: this.answerKey(),
      allowPartial: "allowPartial" in this.q && this.q.allowPartial,
      remaining: this.answers.filter((a) => a.grade === "ungraded").length,
      groups: [...groups.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .map(([normalized, answers]) => ({
          normalized,
          text: answers[0].text,
          count: answers.length,
          answerIds: answers.map((a) => a.id),
          grade: answers.every((a) => a.grade === answers[0].grade)
            ? answers[0].grade
            : "mixed",
          suggested: answers.every((a) => a.gradedBy === "auto"),
          answers: answers.map((a) => ({
            id: a.id,
            text: a.text,
            featured: a.featured,
            grade: a.grade,
            ...(names
              ? { nickname: this.state.players[a.playerId]?.nickname }
              : {}),
          })),
        })),
    };
  }
}
