import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createApp } from "./build/server/app.js";
import { questionFileSchema } from "./build/shared/questions.js";
process.chdir(dirname(fileURLToPath(import.meta.url)));
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const openBrowser = (url) => {
  if (process.env.TRIVIA_NO_OPEN === "1") return;
  const child =
    process.platform === "win32"
      ? spawn("rundll32", ["url.dll,FileProtocolHandler", url], {
          detached: true,
          stdio: "ignore",
        })
      : spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], {
          detached: true,
          stdio: "ignore",
        });
  child.on("error", () =>
    console.log(`Open this link in your browser: ${url}`),
  );
  child.unref();
};
try {
  mkdirSync("data", { recursive: true });
  const secretsFile = join("data", "access.json");
  const secrets = existsSync(secretsFile)
    ? JSON.parse(readFileSync(secretsFile, "utf8"))
    : {
        host: randomBytes(24).toString("hex"),
        grader: randomBytes(24).toString("hex"),
      };
  writeFileSync(secretsFile, JSON.stringify(secrets), { mode: 0o600 });
  const interfaces = Object.entries(networkInterfaces()).flatMap(
    ([name, items]) =>
      (items ?? [])
        .filter((i) => i.family === "IPv4" && !i.internal)
        .map((i) => ({ name, address: i.address })),
  );
  const local = interfaces.filter(
    (i) => !/^docker|^veth|^br-|^virbr|^utun/i.test(i.name),
  );
  const address =
    local.find((i) => /^192\.168\./.test(i.address))?.address ??
    local.find((i) => /^10\./.test(i.address))?.address ??
    local[0]?.address ??
    "127.0.0.1";
  const port = Number(process.env.PORT ?? 3000),
    origin = process.env.PUBLIC_URL ?? `http://${address}:${port}`;
  const file = questionFileSchema.parse(
    JSON.parse(readFileSync("questions.json", "utf8")),
  );
  const { app } = await createApp({
    file,
    hostKey: secrets.host,
    graderKey: secrets.grader,
    publicUrl: origin,
    snapshotPath: "data/state.json",
  });
  app.get("/setup", async (request, reply) => {
    if (request.query?.key !== secrets.host)
      return reply
        .code(403)
        .send("Open the private setup link printed by the launcher.");
    const host = `${origin}/host?key=${secrets.host}`,
      grader = `${origin}/grade?key=${secrets.grader}`;
    const guide = existsSync("TESTING.md")
      ? readFileSync("TESTING.md", "utf8")
      : "";
    return reply
      .header("Cache-Control", "no-store")
      .header("Referrer-Policy", "no-referrer")
      .type("text/html")
      .send(
        `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Party Trivia — start here</title><style>body{font:18px/1.5 system-ui;background:#17111f;color:#fff4e5;max-width:850px;margin:40px auto;padding:20px}h1{font-size:42px}a{color:#ffd05c}nav{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:16px}nav a{display:block;background:#ff814a;color:#201425;border-radius:16px;padding:24px;text-decoration:none;font-weight:700}section{margin-top:32px;background:#292031;border-radius:16px;padding:24px}pre{white-space:pre-wrap;font:inherit;overflow-wrap:anywhere}small{color:#cfbecf}</style><h1>Your trivia test is ready</h1><p>Open the display on your computer, then join as a player on your phone. Use Host controls to run the game.</p><nav><a href="${escape(origin)}/display" target="_blank" rel="noreferrer">1. Open display</a><a href="${escape(host)}" target="_blank" rel="noreferrer">2. Host controls</a><a href="${escape(origin)}/play" target="_blank" rel="noreferrer">3. Join as a player</a><a href="${escape(grader)}" target="_blank" rel="noreferrer">4. Open grader</a></nav><section><h2>Testing with phones</h2><p>Keep the computer and phones on the same Wi-Fi. Scan the QR code on the display.</p><p>Player link: <a href="${escape(origin)}/play">${escape(origin)}/play</a></p><p>Keep this launcher window running while you test. To finish, close its status window. Your progress is saved.</p><small>Keep this setup page and the host and grader links private. If your phone cannot connect, check the Wi-Fi and allow the app through your computer's firewall on private networks. You can also test the whole game in separate tabs on this computer.</small></section><section><h2>10-minute test guide</h2><pre>${escape(guide)}</pre></section></html>`,
      );
  });
  await app.listen({ host: "0.0.0.0", port });
  const setup = `http://127.0.0.1:${port}/setup?key=${secrets.host}`;
  console.log(
    `\nPARTY TRIVIA IS READY\n\nIf your browser did not open, open:\n${setup}\n\nPhone/player link: ${origin}/play\n\nKeep this window open while you test. Close it to stop.\n`,
  );
  openBrowser(setup);
  for (const sig of ["SIGINT", "SIGTERM"])
    process.on(sig, () => void app.close().then(() => process.exit(0)));
} catch (error) {
  console.error(
    "\nCould not start Party Trivia.\n" +
      error.message +
      "\n\nIf another copy is running, close its window and try again. Otherwise send this message to the person who gave you the app.",
  );
  process.exitCode = 1;
}
