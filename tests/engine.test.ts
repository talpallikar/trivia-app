import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine } from "../src/server/engine.js";
import { SnapshotStore } from "../src/server/persistence.js";
import { questionFileSchema } from "../src/shared/questions.js";
const file = () =>
  questionFileSchema.parse({
    title: "Test",
    rounds: [
      {
        title: "One",
        questions: [
          {
            id: "mc",
            type: "mc",
            prompt: "Pick",
            options: ["A", "B"],
            correct: 1,
          },
          {
            id: "short",
            type: "short",
            prompt: "Capital",
            answer: "Paris",
            acceptable: ["Paris"],
            allowPartial: true,
          },
          { id: "free", type: "free", prompt: "Explain", allowPartial: false },
        ],
      },
    ],
  });
function setup() {
  const e = new Engine(file());
  const a = e.join("Ada"),
    b = e.join("Ben");
  e.command("start", 0);
  e.command("next", 1000);
  return { e, a, b };
}
function textSetup() {
  const { e, a, b } = setup();
  e.command("skip", 1100);
  e.command("next", 1100);
  e.command("next", 2000);
  return { e, a, b };
}
test("schema rejects invalid question indices, duplicate ids and unsafe images", () => {
  const f = file();
  (f.rounds[0].questions[0] as any).correct = 5;
  assert.throws(() => questionFileSchema.parse(f));
  const dup = file();
  dup.rounds[0].questions.push(dup.rounds[0].questions[0]);
  assert.throws(() => questionFileSchema.parse(dup));
  const img = file();
  img.rounds[0].questions[0].image = "/media/../secret";
  assert.throws(() => questionFileSchema.parse(img));
});
test("answer locks idempotently, auto closes and speed scores on server time", () => {
  const { e, a, b } = setup();
  const ans = e.answer(a.id, { questionId: "mc", choice: 1 }, 11000);
  assert.equal(
    e.answer(a.id, { questionId: "mc", choice: 0 }, 11001).id,
    ans.id,
  );
  assert.equal(e.answers.length, 1);
  e.answer(b.id, { questionId: "mc", choice: 0 }, 21000);
  assert.equal(e.state.phase, "reveal");
  assert.equal(a.score, 750);
  assert.equal(b.score, 0);
});
test("pause excludes pause duration from points; deadline has 300ms grace", () => {
  const { e, a, b } = setup();
  e.command("pause", 6000);
  assert.throws(() => e.answer(a.id, { questionId: "mc", choice: 1 }, 7000));
  e.command("resume", 106000);
  e.answer(a.id, { questionId: "mc", choice: 1 }, 111000);
  e.answer(b.id, { questionId: "mc", choice: 1 }, 121250);
  assert.equal(a.score, 750);
  assert.equal(b.score, 500);
  const x = setup();
  assert.equal(x.e.tick(21299), false);
  assert.equal(x.e.tick(21300), true);
  assert.throws(() =>
    x.e.answer(x.a.id, { questionId: "mc", choice: 1 }, 21301),
  );
});
test("late joiners wait for next question, refresh restores identity and scores", () => {
  const { e, a } = setup();
  const late = e.join("Late");
  assert.throws(() => e.answer(late.id, { questionId: "mc", choice: 1 }, 2000));
  e.answer(a.id, { questionId: "mc", choice: 1 }, 2000);
  assert.equal(e.rejoin(a.token).id, a.id);
  assert.throws(() => e.join("ADA"));
  assert.throws(() => e.rejoin("invalid"));
});
test("text groups normalize, auto match, allow bulk regrade, preserve adjustments", () => {
  const { e, a, b } = textSetup();
  e.answer(a.id, { questionId: "short", text: " Paris! " }, 2100);
  e.answer(b.id, { questionId: "short", text: "paris" }, 2200);
  assert.equal(e.state.phase, "grading");
  assert.equal(e.queue()!.groups.length, 1);
  assert.equal(e.queue()!.groups[0].count, 2);
  assert.equal(e.queue()!.groups[0].grade, "correct");
  assert.equal("nickname" in e.queue()!.groups[0].answers[0], false);
  assert.equal(e.queue(true)!.groups[0].answers[0].nickname, "Ada");
  e.finishGrading();
  e.adjust(a.id, 75);
  e.grade(
    e.answers.map((a) => a.id),
    "partial",
    "short",
  );
  assert.equal(a.score, 575);
  assert.equal(b.score, 500);
  e.grade(
    e.answers.map((a) => a.id),
    "correct",
    "short",
  );
  assert.equal(a.score, 1075);
});
test("ungraded answers require confirmation, featured answers only appear after reveal", () => {
  const { e, a, b } = textSetup();
  e.answer(a.id, { questionId: "short", text: "secret phrase" }, 2100);
  e.answer(b.id, { questionId: "short", text: "unknown" }, 2200);
  assert.throws(() => e.finishGrading());
  const id = e.answers[0].id;
  e.feature(id, true);
  for (const role of ["display", "host", "player"]) {
    const v = e.view(role, role === "player" ? b.id : undefined, 2300, "/play");
    assert.ok(!JSON.stringify(v).includes("secret phrase"));
    assert.ok(!("answerKey" in v));
  }
  e.finishGrading(true);
  assert.equal(a.score, 0);
  assert.equal(
    e.view("display", undefined, 2400, "/play").featured?.[0].text,
    "secret phrase",
  );
  assert.equal(e.view("player", b.id, 2400, "/play").featured, undefined);
});
test("blank, oversized, wrong type, invalid partial and unauthorized phases rejected", () => {
  const { e, a, b } = textSetup();
  assert.throws(() =>
    e.answer(a.id, { questionId: "short", text: " ".repeat(3) }, 2100),
  );
  assert.throws(() =>
    e.answer(a.id, { questionId: "short", text: "x".repeat(41) }, 2100),
  );
  assert.throws(() => e.answer(a.id, { questionId: "short", choice: 1 }, 2100));
  e.command("skip", 2200);
  e.command("next", 2300);
  e.command("next", 2400);
  e.answer(a.id, { questionId: "free", text: "Hello" }, 2500);
  e.answer(b.id, { questionId: "free", text: "World" }, 2600);
  assert.throws(() =>
    e.grade(
      e.answers.map((a) => a.id),
      "partial",
      "free",
    ),
  );
});
test("snapshot survives grading, detects corruption and changed question files", () => {
  const { e, a, b } = textSetup();
  e.answer(a.id, { questionId: "short", text: "London" }, 2100);
  e.answer(b.id, { questionId: "short", text: "Rome" }, 2200);
  e.grade([e.answers[0].id], "partial", "short");
  const path = join(mkdtempSync(join(tmpdir(), "trivia-test-")), "state.json");
  const store = new SnapshotStore(path, e.file);
  store.save(e.state);
  const restored = new Engine(e.file, store.load(e.file));
  assert.equal(restored.state.phase, "grading");
  assert.equal(restored.answers[0].grade, "partial");
  assert.equal(restored.state.players[a.id].score, 500);
  assert.equal(restored.state.players[a.id].connected, false);
  assert.equal(restored.rejoin(a.token).id, a.id);
  const changed = file();
  changed.title = "Changed";
  assert.throws(() => new SnapshotStore(path, changed).load(changed));
  assert.ok(readFileSync(path, "utf8").includes(a.token));
  writeFileSync(path, "{broken");
  assert.throws(() => store.load(e.file));
});
test("round transitions, kick and restart remain coherent", () => {
  const { e, a, b } = setup();
  e.answer(a.id, { questionId: "mc", choice: 1 }, 2000);
  e.kick(b.id);
  assert.equal(e.state.phase, "reveal");
  assert.throws(() => e.rejoin(b.token));
  e.command("end", 3000);
  assert.equal(e.state.phase, "final");
  e.command("restart", 4000);
  assert.equal(e.state.phase, "lobby");
  assert.equal(e.state.players[a.id].score, 0);
  assert.equal(e.state.answers.length, 0);
});

test("active snapshot restores paused at last saved remaining time", () => {
  const e = new Engine(file());
  e.join("Ada");
  const now = Date.now();
  e.command("start", now);
  e.command("next", now);
  const path = join(
    mkdtempSync(join(tmpdir(), "trivia-active-")),
    "state.json",
  );
  const store = new SnapshotStore(path, e.file);
  store.save(e.state);
  const restored = store.load(e.file)!;
  assert.equal(restored.phase, "paused");
  assert.ok(restored.remainingMs! > 19000 && restored.remainingMs! <= 20000);
  const resumed = new Engine(e.file, restored);
  resumed.command("resume", now + 100000);
  assert.ok(resumed.state.deadline! > now + 119000);
});
