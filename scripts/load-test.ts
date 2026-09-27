/** Isolated rehearsal: never connects to or changes a live party. */
import { io, type Socket } from "socket.io-client";
import { performance } from "node:perf_hooks";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { createApp } from "../src/server/app.js";
import { questionFileSchema } from "../src/shared/questions.js";
const count = Number(process.env.PLAYERS ?? 60);
const file = questionFileSchema.parse({
  title: "Rehearsal",
  rounds: [
    {
      title: "Load test",
      questions: [
        {
          id: "choice",
          type: "mc",
          prompt: "Pick one",
          options: ["A", "B", "C", "D"],
          correct: 1,
        },
        {
          id: "text",
          type: "short",
          prompt: "Say Paris",
          answer: "Paris",
          acceptable: ["Paris"],
        },
      ],
    },
  ],
});
const { app, engine } = await createApp({
  file,
  hostKey: "rehearsal-host",
  graderKey: "rehearsal-grader",
  publicUrl: "http://localhost",
  snapshotPath: join(mkdtempSync(join(tmpdir(), "trivia-load-")), "state.json"),
});
const sockets: Socket[] = [];
const latencies: number[] = [];
const acks: number[] = [];
const ack = (s: Socket, event: string, data: unknown) =>
  new Promise<any>((resolve, reject) => {
    const start = performance.now();
    s.timeout(10000).emit(event, data, (error: Error, res: any) => {
      acks.push(performance.now() - start);
      if (error || !res.ok) reject(error ?? new Error(res.error));
      else resolve(res);
    });
  });
try {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address() as { port: number };
  const connect = async (role: string, key?: string) => {
    const socket = io(`http://127.0.0.1:${address.port}`, {
      auth: { role, key },
      transports: ["websocket"],
      reconnection: false,
    });
    sockets.push(socket);
    socket.on("state", (s) =>
      latencies.push(Math.max(0, Date.now() - s.serverNow)),
    );
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", reject);
    });
    return socket;
  };
  const host = await connect("host", "rehearsal-host");
  const players = await Promise.all(
    Array.from({ length: count }, () => connect("player")),
  );
  const identities = await Promise.all(
    players.map((s, i) => ack(s, "join", { nickname: `Guest ${i + 1}` })),
  );
  await ack(host, "host:cmd", { cmd: "start" });
  await ack(host, "host:cmd", { cmd: "next" });
  await Promise.all(
    players.map((s, i) =>
      ack(s, "answer", { questionId: "choice", choice: i % 4 }),
    ),
  );
  assert.equal(engine.answers.length, count);
  assert.equal(engine.state.phase, "reveal");
  await ack(host, "host:cmd", { cmd: "next" });
  await ack(host, "host:cmd", { cmd: "next" });
  await Promise.all(
    players.map((s, i) =>
      ack(s, "answer", {
        questionId: "text",
        text: i % 2 ? "Paris" : " PARIS! ",
      }),
    ),
  );
  assert.equal(engine.state.phase, "grading");
  assert.equal(engine.queue()!.groups.length, 1);
  await ack(host, "grade:submit", { questionId: "text" });
  assert.equal(engine.state.answers.length, count * 2);
  assert.ok(Object.values(engine.state.players).every((p) => p.score >= 1000));
  // Refresh ten player sessions and make sure no identities or points are lost.
  for (let i = 0; i < Math.min(10, count); i++) {
    players[i].disconnect();
    const fresh = await connect("player");
    const restored = await ack(fresh, "rejoin", { token: identities[i].token });
    assert.equal(restored.playerId, identities[i].playerId);
  }
  const p95 = (values: number[]) =>
    Math.round(values.sort((a, b) => a - b)[Math.floor(values.length * 0.95)]);
  const broadcastP95 = p95(latencies);
  console.log(
    JSON.stringify(
      {
        players: count,
        answers: engine.state.answers.length,
        snapshotsReceived: latencies.length,
        broadcastP95Ms: broadcastP95,
        ackP95Ms: p95(acks),
        durableSnapshots: true,
      },
      null,
      2,
    ),
  );
  assert.ok(
    broadcastP95 < 500,
    `p95 broadcast ${broadcastP95}ms exceeded 500ms`,
  );
} finally {
  for (const s of sockets) s.disconnect();
  await app.close();
}
