import { test } from "node:test";
import assert from "node:assert/strict";
import { io, type Socket } from "socket.io-client";
import { createApp } from "../src/server/app.js";
import { questionFileSchema } from "../src/shared/questions.js";
const file = questionFileSchema.parse({
  title: "Test",
  rounds: [
    {
      title: "Round",
      questions: [
        { id: "q", type: "short", prompt: "Capital?", answer: "Paris" },
      ],
    },
  ],
});
const ack = (s: Socket, event: string, data: unknown) =>
  new Promise<any>((resolve, reject) =>
    s
      .timeout(2000)
      .emit(event, data, (err: Error, value: any) =>
        err ? reject(err) : resolve(value),
      ),
  );
test("real sockets enforce roles, persist identity, hide keys and bulk grade", async () => {
  const { app, engine } = await createApp({
    file,
    hostKey: "host-secret",
    graderKey: "grader-secret",
    publicUrl: "http://localhost",
  });
  const sockets: Socket[] = [];
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}`;
  const connect = async (role: string, key?: string) => {
    const s = io(url, {
      auth: { role, key },
      transports: ["websocket"],
      reconnection: false,
    });
    sockets.push(s);
    await new Promise<void>((resolve, reject) => {
      s.once("connect", () => resolve());
      s.once("connect_error", reject);
    });
    return s;
  };
  try {
    await assert.rejects(connect("host", "wrong"), /Invalid access key/);
    const host = await connect("host", "host-secret"),
      grader = await connect("grader", "grader-secret"),
      player = await connect("player"),
      display = await connect("display");
    let screen: any;
    display.on("state", (s) => (screen = s));
    assert.equal((await ack(player, "host:cmd", { cmd: "start" })).ok, false);
    const joined = await ack(player, "join", { nickname: "Ada" });
    assert.ok(joined.token);
    await ack(host, "host:cmd", { cmd: "start" });
    await ack(host, "host:cmd", { cmd: "next" });
    assert.equal(
      (await ack(player, "answer", { questionId: "q", text: "Private answer" }))
        .ok,
      true,
    );
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(screen.phase, "grading");
    assert.ok(!JSON.stringify(screen).includes("Private answer"));
    assert.ok(!JSON.stringify(screen).includes("Paris"));
    assert.ok(!JSON.stringify(screen).includes(joined.token));
    assert.equal(
      (await ack(grader, "grade:submit", { questionId: "q" })).ok,
      false,
    );
    await ack(grader, "grade:set", {
      questionId: "q",
      answerIds: [engine.answers[0].id],
      grade: "correct",
    });
    await ack(grader, "grade:submit", { questionId: "q" });
    assert.equal(engine.state.players[joined.playerId].score, 1000);
    const second = await connect("player");
    assert.equal(
      (await ack(second, "rejoin", { token: joined.token })).playerId,
      joined.playerId,
    );
    player.disconnect();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(engine.state.players[joined.playerId].connected, true);
    await ack(host, "host:adjust", { kick: joined.playerId });
    assert.equal(
      (await ack(await connect("player"), "rejoin", { token: joined.token }))
        .ok,
      false,
    );
    assert.equal((await app.inject("/health")).statusCode, 200);
  } finally {
    for (const s of sockets) s.disconnect();
    await app.close();
  }
});
