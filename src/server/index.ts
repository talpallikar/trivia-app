import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { questionFileSchema } from "../shared/questions.js";
import { createApp } from "./app.js";
try {
  const file = questionFileSchema.parse(
    JSON.parse(
      readFileSync(process.env.QUESTIONS_FILE ?? "questions.json", "utf8"),
    ),
  );
  const port = Number(process.env.PORT ?? 3000);
  const publicUrl = process.env.PUBLIC_URL ?? `http://localhost:${port}`;
  const url = new URL(publicUrl);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("PUBLIC_URL must be HTTP or HTTPS");
  if (
    process.env.NODE_ENV === "production" &&
    (!process.env.HOST_KEY ||
      !process.env.GRADER_KEY ||
      !process.env.PUBLIC_URL)
  )
    throw new Error("Production requires HOST_KEY, GRADER_KEY, and PUBLIC_URL");
  const hostKey = process.env.HOST_KEY ?? randomBytes(24).toString("hex");
  const graderKey = process.env.GRADER_KEY ?? randomBytes(24).toString("hex");
  const { app } = await createApp({
    file,
    hostKey,
    graderKey,
    publicUrl,
    snapshotPath: process.env.SNAPSHOT_FILE ?? "data/state.json",
  });
  await app.listen({ port, host: process.env.BIND_HOST ?? "0.0.0.0" });
  console.log(
    `Party Trivia listening on ${port}\nDisplay: ${publicUrl}/display\nHost: ${publicUrl}/host?key=${encodeURIComponent(hostKey)}\nGrader: ${publicUrl}/grade?key=${encodeURIComponent(graderKey)}`,
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
      void app.close().then(() => process.exit(0));
    });
} catch (error) {
  console.error(
    "Startup failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
}
