import {
  existsSync,
  readFileSync,
  mkdirSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  renameSync,
} from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { State } from "./engine.js";
import type { QuestionFile } from "../shared/questions.js";
const player = z.object({
  id: z.string(),
  token: z.string(),
  nickname: z.string(),
  score: z.number(),
  adjustment: z.number(),
  connected: z.boolean(),
  kicked: z.boolean(),
});
const answer = z.object({
  id: z.string(),
  playerId: z.string(),
  questionId: z.string(),
  choice: z.union([z.number(), z.boolean()]).optional(),
  text: z.string().optional(),
  normalized: z.string().optional(),
  receivedAt: z.number(),
  elapsedMs: z.number().nonnegative(),
  grade: z.enum(["correct", "partial", "wrong", "ungraded"]),
  points: z.number(),
  featured: z.boolean(),
  gradedBy: z.enum(["auto", "human"]).optional(),
});
const stateSchema = z.object({
  phase: z.enum([
    "lobby",
    "roundIntro",
    "question",
    "paused",
    "grading",
    "reveal",
    "leaderboard",
    "final",
  ]),
  roundIdx: z.number().int().nonnegative(),
  questionIdx: z.number().int().nonnegative(),
  version: z.number().int(),
  players: z.record(player),
  answers: z.array(answer),
  eligible: z.array(z.string()),
  deadline: z.number().nullable(),
  remainingMs: z.number().nullable(),
  elapsedMs: z.number(),
  resumedAt: z.number().nullable(),
});
export class SnapshotStore {
  fingerprint: string;
  constructor(
    public path: string,
    file: QuestionFile,
  ) {
    this.fingerprint = createHash("sha256")
      .update(JSON.stringify(file))
      .digest("hex");
  }
  load(file: QuestionFile): State | undefined {
    if (!existsSync(this.path)) return;
    try {
      const value = z
        .object({
          fingerprint: z.string(),
          savedAt: z.number(),
          state: stateSchema,
        })
        .parse(JSON.parse(readFileSync(this.path, "utf8")));
      if (value.fingerprint !== this.fingerprint)
        throw new Error(
          "Question file changed; archive or delete the old snapshot before starting a new game",
        );
      const s = value.state;
      if (!file.rounds[s.roundIdx]?.questions[s.questionIdx])
        throw new Error("Invalid question position");
      for (const p of Object.values(s.players)) p.connected = false;
      // A restored timed question waits for the host, preserving answers without silently consuming the round during downtime.
      if (s.phase === "question") {
        s.remainingMs = Math.max(0, s.deadline! - value.savedAt);
        s.elapsedMs = Math.max(0, s.elapsedMs + value.savedAt - s.resumedAt!);
        s.phase = "paused";
        s.deadline = null;
        s.resumedAt = null;
      }
      s.version++;
      return s;
    } catch (e) {
      throw new Error(
        `Cannot restore snapshot ${this.path}: ${(e as Error).message}`,
      );
    }
  }
  save(state: State) {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = this.path + ".tmp";
    const fd = openSync(tmp, "w", 0o600);
    try {
      writeFileSync(
        fd,
        JSON.stringify({
          fingerprint: this.fingerprint,
          savedAt: Date.now(),
          state,
        }),
      );
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, this.path);
  }
}
