import { z } from "zod";
const base = {
  id: z.string().min(1),
  prompt: z.string().min(1),
  image: z
    .string()
    .regex(/^\/media\/(?!.*\.\.)[\w./-]+$/)
    .optional(),
  timeLimitSec: z.number().min(1).max(600).optional(),
  points: z.number().int().min(0).max(100000).default(1000),
};
const questionSchema = z
  .discriminatedUnion("type", [
    z
      .object({
        ...base,
        type: z.literal("mc"),
        options: z.array(z.string().min(1)).min(2).max(6),
        correct: z.number().int().min(0),
      })
      .strict(),
    z.object({ ...base, type: z.literal("tf"), correct: z.boolean() }).strict(),
    z
      .object({
        ...base,
        type: z.literal("short"),
        answer: z.string().min(1),
        acceptable: z.array(z.string()).optional(),
        allowPartial: z.boolean().default(false),
      })
      .strict(),
    z
      .object({
        ...base,
        type: z.literal("free"),
        answer: z.string().optional(),
        maxChars: z.number().int().min(1).max(300).default(300),
        allowPartial: z.boolean().default(false),
      })
      .strict(),
  ])
  .superRefine((q, ctx) => {
    if (q.type === "mc" && q.correct >= q.options.length)
      ctx.addIssue({
        code: "custom",
        message: "correct must be an existing option index",
      });
  });
export const questionFileSchema = z
  .object({
    title: z.string().min(1),
    defaultTimeLimitSec: z
      .object({
        choice: z.number().min(1).max(600),
        text: z.number().min(1).max(600),
      })
      .default({ choice: 20, text: 45 }),
    rounds: z
      .array(
        z.object({
          title: z.string().min(1),
          questions: z.array(questionSchema).min(1),
        }),
      )
      .min(1),
  })
  .superRefine((f, c) => {
    const ids = f.rounds.flatMap((r) => r.questions.map((q) => q.id));
    if (new Set(ids).size !== ids.length)
      c.addIssue({ code: "custom", message: "Question IDs must be unique" });
  });
export type QuestionFile = z.infer<typeof questionFileSchema>;
export type Question = QuestionFile["rounds"][number]["questions"][number];
export const isText = (q: Question) => q.type === "short" || q.type === "free";
export const normalize = (text: string) =>
  text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim()
    .replace(/\s+/g, " ");
