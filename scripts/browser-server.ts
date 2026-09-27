import { readFileSync } from "node:fs";
import { createApp } from "../src/server/app.js";
import { questionFileSchema } from "../src/shared/questions.js";
const file = questionFileSchema.parse(
  JSON.parse(readFileSync("questions.json", "utf8")),
);
const { app } = await createApp({
  file,
  hostKey: "browser-host",
  graderKey: "browser-grader",
  publicUrl: "http://127.0.0.1:3107",
});
await app.listen({ port: 3107, host: "127.0.0.1" });
