// Socket contract shared by client and server (see collaboration/CLAUDE-TASK.md). Types only: no runtime imports.
export type Role = "display" | "player" | "host" | "grader";
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
export type QuestionType = "mc" | "tf" | "short" | "free";

export type QuestionView = {
  id: string;
  type: QuestionType;
  prompt: string;
  image?: string;
  options?: string[];
  timeLimitSec: number;
  points: number;
  maxChars?: number;
  allowPartial?: boolean;
};

export type PlayerView = {
  id: string;
  nickname: string;
  score: number;
  connected: boolean;
};
export type RankEntry = {
  id: string;
  nickname: string;
  score: number;
  rank: number;
};
export type OwnAnswer = {
  id: string;
  choice?: number | boolean;
  text?: string;
  grade: Grade;
  points: number;
};
export type Me = {
  id: string;
  nickname: string;
  score: number;
  rank?: number;
  eligible: boolean;
  answer?: OwnAnswer;
};
export type Featured = { id: string; text?: string; nickname?: string };

export type GameState = {
  version: number;
  serverNow: number;
  title: string;
  phase: Phase;
  roundTitle: string;
  roundIdx: number;
  questionIdx: number;
  questionNumber: number;
  totalQuestions: number;
  joinUrl: string;
  deadline: number | null;
  remainingMs: number | null;
  question: QuestionView | null;
  players: PlayerView[];
  leaderboard: RankEntry[];
  answerCount: number;
  eligibleCount: number;
  grading: { total: number; graded: number };
  answerKey?: string;
  distribution?: number[];
  featured?: Featured[];
  me?: Me;
  error?: string;
};

export type QueueAnswer = {
  id: string;
  text?: string;
  featured: boolean;
  grade: Grade;
  nickname?: string;
};
export type QueueGroup = {
  normalized: string;
  text?: string;
  count: number;
  answerIds: string[];
  grade: Grade | "mixed";
  suggested: boolean;
  answers: QueueAnswer[];
};
export type GradeQueue = {
  questionId: string;
  prompt: string;
  answerKey: string;
  allowPartial: boolean;
  groups: QueueGroup[];
  remaining: number;
};

export type Ack<T = object> = ({ ok: true } & T) | { ok: false; error: string };
export type Emit = <T = object>(
  event: string,
  payload: unknown,
) => Promise<Ack<T>>;
