import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { Server, type Socket } from "socket.io";
import { z } from "zod";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { Engine } from "./engine.js";
import { SnapshotStore } from "./persistence.js";
import type { QuestionFile } from "../shared/questions.js";
const secureEqual = (a: unknown, b: string) =>
  typeof a === "string" &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
export async function createApp(config: {
  file: QuestionFile;
  hostKey: string;
  graderKey: string;
  snapshotPath?: string;
  publicUrl: string;
  staticDir?: string;
}) {
  const app = Fastify({ logger: false });
  const store = config.snapshotPath
    ? new SnapshotStore(config.snapshotPath, config.file)
    : undefined;
  const engine = new Engine(config.file, store?.load(config.file));
  engine.recompute();
  const io = new Server(app.server, { maxHttpBufferSize: 16384 });
  const joinUrl = config.publicUrl.replace(/\/$/, "") + "/play";
  const save = () => store?.save(engine.state);
  function broadcast() {
    const ranking = engine.ranking();
    for (const socket of io.sockets.sockets.values()) {
      socket.emit(
        "state",
        engine.view(
          socket.data.role,
          socket.data.playerId,
          Date.now(),
          joinUrl,
          ranking,
        ),
      );
      if (["host", "grader"].includes(socket.data.role))
        socket.emit("grade:queue", engine.queue(socket.data.names === true));
    }
  }
  function mutate(fn: () => unknown) {
    const previous = structuredClone(engine.state);
    try {
      const value = fn();
      save();
      broadcast();
      return value;
    } catch (e) {
      engine.state = previous;
      throw e;
    }
  }
  io.use((socket, next) => {
    const role = socket.handshake.auth.role ?? "display";
    if (!["display", "player", "host", "grader"].includes(role))
      return next(new Error("Unknown role"));
    const key = socket.handshake.auth.key;
    if (
      (role === "host" && !secureEqual(key, config.hostKey)) ||
      (role === "grader" &&
        !secureEqual(key, config.graderKey) &&
        !secureEqual(key, config.hostKey))
    )
      return next(new Error("Invalid access key"));
    socket.data.role = role;
    next();
  });
  io.on("connection", (socket: Socket) => {
    let windowStart = Date.now(),
      count = 0;
    const on = (
      event: string,
      schema: z.ZodTypeAny,
      roles: string[],
      handler: (input: any) => unknown,
    ) =>
      socket.on(event, (raw: unknown, ack?: Function) => {
        if (typeof ack !== "function") return;
        try {
          if (Date.now() - windowStart > 1000) {
            windowStart = Date.now();
            count = 0;
          }
          if (++count > 30) throw new Error("Too many requests; try again");
          if (!roles.includes(socket.data.role))
            throw new Error("Not authorized");
          const input = schema.parse(raw);
          const result = handler(input);
          ack({
            ok: true,
            ...(result && typeof result === "object" ? result : {}),
          });
        } catch (error) {
          ack({
            ok: false,
            error:
              error instanceof z.ZodError
                ? error.issues
                    .map((i) => `${i.path.join(".")}: ${i.message}`)
                    .join("; ")
                : (error as Error).message,
          });
        }
      });
    on("clock", z.object({}), ["player", "display", "host", "grader"], () => ({
      serverNow: Date.now(),
    }));
    on(
      "join",
      z
        .object({
          nickname: z
            .string()
            .trim()
            .min(1)
            .max(16)
            .refine(
              (s) => !/[\p{C}]/u.test(s),
              "Nickname contains invalid characters",
            ),
        })
        .strict(),
      ["player"],
      ({ nickname }) => {
        if (socket.data.playerId) throw new Error("Already joined");
        const p = mutate(() => engine.join(nickname)) as ReturnType<
          Engine["join"]
        >;
        socket.data.playerId = p.id;
        broadcast();
        return { playerId: p.id, token: p.token };
      },
    );
    on(
      "rejoin",
      z.object({ token: z.string().uuid() }).strict(),
      ["player"],
      ({ token }) => {
        const p = Object.values(engine.state.players).find(
          (p) => p.token === token && !p.kicked,
        );
        if (!p) throw new Error("Player session not found");
        if (socket.data.playerId && socket.data.playerId !== p.id)
          throw new Error("Already joined");
        mutate(() => engine.rejoin(token));
        socket.data.playerId = p.id;
        broadcast();
        return { playerId: p.id, token: p.token };
      },
    );
    on(
      "answer",
      z
        .object({
          questionId: z.string(),
          choice: z.union([z.number().finite(), z.boolean()]).optional(),
          text: z.string().max(300).optional(),
        })
        .strict(),
      ["player"],
      (input) => {
        if (!socket.data.playerId) throw new Error("Join before answering");
        mutate(() => engine.answer(socket.data.playerId, input, Date.now()));
      },
    );
    on(
      "host:cmd",
      z
        .object({
          cmd: z.enum([
            "start",
            "next",
            "pause",
            "resume",
            "skip",
            "end",
            "forceReveal",
            "restart",
          ]),
        })
        .strict(),
      ["host"],
      ({ cmd }) => mutate(() => engine.command(cmd, Date.now())),
    );
    on(
      "host:adjust",
      z.union([
        z
          .object({
            playerId: z.string(),
            delta: z.number().int().min(-100000).max(100000),
          })
          .strict(),
        z.object({ kick: z.string() }).strict(),
      ]),
      ["host"],
      (input) => {
        mutate(() =>
          "kick" in input
            ? engine.kick(input.kick)
            : engine.adjust(input.playerId, input.delta),
        );
        if ("kick" in input)
          for (const other of io.sockets.sockets.values())
            if (other.data.playerId === input.kick) {
              other.emit("kicked");
              other.disconnect(true);
            }
      },
    );
    on(
      "grade:set",
      z
        .object({
          questionId: z.string(),
          answerIds: z.array(z.string()).min(1).max(1000),
          grade: z.enum(["correct", "partial", "wrong"]),
        })
        .strict(),
      ["host", "grader"],
      ({ questionId, answerIds, grade }) =>
        mutate(() => engine.grade(answerIds, grade, questionId)),
    );
    on(
      "grade:feature",
      z.object({ answerId: z.string(), featured: z.boolean() }).strict(),
      ["host", "grader"],
      ({ answerId, featured }) =>
        mutate(() => engine.feature(answerId, featured)),
    );
    on(
      "grade:submit",
      z
        .object({ questionId: z.string(), force: z.boolean().optional() })
        .strict(),
      ["host", "grader"],
      ({ questionId, force }) => {
        if (questionId !== engine.q.id) throw new Error("Wrong question");
        mutate(() => engine.finishGrading(force));
      },
    );
    on(
      "grade:names",
      z.object({ show: z.boolean() }).strict(),
      ["host", "grader"],
      ({ show }) => {
        socket.data.names = show;
        socket.emit("grade:queue", engine.queue(show));
      },
    );
    socket.on("disconnect", () => {
      const id = socket.data.playerId;
      if (
        id &&
        engine.state.players[id] &&
        ![...io.sockets.sockets.values()].some((s) => s.data.playerId === id)
      ) {
        try {
          mutate(() => {
            engine.state.players[id].connected = false;
            engine.touch();
          });
        } catch (e) {
          app.log.error(e);
        }
      }
    });
    broadcast();
  });
  const timer = setInterval(() => {
    if (
      engine.state.phase === "question" &&
      Date.now() >= (engine.state.deadline ?? Infinity) + 300
    ) {
      try {
        mutate(() => engine.tick(Date.now()));
      } catch (e) {
        console.error(
          "Snapshot write failed; game transition was rolled back",
          e,
        );
      }
    }
  }, 50);
  timer.unref();
  app.get("/health", async () => ({
    ok: true,
    phase: engine.state.phase,
    version: engine.state.version,
  }));
  const media = resolve("media");
  if (existsSync(media))
    await app.register(fastifyStatic, {
      root: media,
      prefix: "/media/",
      decorateReply: false,
      dotfiles: "deny",
    });
  const dist = config.staticDir ?? resolve("dist");
  if (existsSync(dist)) {
    await app.register(fastifyStatic, {
      root: dist,
      prefix: "/",
      dotfiles: "deny",
    });
    app.setNotFoundHandler((request, reply) => {
      if (
        ["/", "/play", "/display", "/host", "/grade"].includes(
          request.url.split("?")[0],
        )
      )
        return reply.type("text/html").sendFile("index.html");
      return reply.code(404).send({ error: "Not found" });
    });
  }
  app.addHook("onClose", async () => {
    clearInterval(timer);
    await new Promise<void>((done) => io.close(() => done()));
  });
  return { app, io, engine, broadcast };
}
