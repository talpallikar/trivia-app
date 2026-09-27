import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { Ack, Emit, GameState, GradeQueue, Role } from "./types";

export type ConnStatus =
  "connecting" | "connected" | "reconnecting" | "closed" | "error";
export type Conn = { status: ConnStatus; error?: string };

const ACK_TIMEOUT = 8000;

/**
 * One socket per page. Tracks the latest state snapshot (ignoring stale versions,
 * resetting the version floor on every reconnect), the grader queue, connection
 * health, and the client/server clock offset.
 */
export function useGame(
  role: Role,
  key: string | null,
  onConnect?: (socket: Socket) => void,
  onKicked?: () => void,
) {
  const [state, setState] = useState<GameState | null>(null);
  const [queue, setQueue] = useState<GradeQueue | null>(null);
  const [conn, setConn] = useState<Conn>({ status: "connecting" });
  const [offset, setOffset] = useState(0);
  const socketRef = useRef<Socket | null>(null);
  const onConnectRef = useRef(onConnect);
  onConnectRef.current = onConnect;
  const onKickedRef = useRef(onKicked);
  onKickedRef.current = onKicked;

  useEffect(() => {
    const socket = io({
      auth: { role, key: key ?? "" },
      reconnectionDelayMax: 4000,
    });
    socketRef.current = socket;
    let lastVersion = -1;
    let synced = false;
    let kicked = false;

    const syncClock = () => {
      const t0 = Date.now();
      socket
        .timeout(5000)
        .emit(
          "clock",
          {},
          (err: Error | null, res?: Ack<{ serverNow: number }>) => {
            if (err || !res || !res.ok) return;
            const t1 = Date.now();
            synced = true;
            setOffset(res.serverNow - (t0 + t1) / 2);
          },
        );
    };

    socket.on("connect", () => {
      lastVersion = -1;
      kicked = false;
      setConn({ status: "connected" });
      syncClock();
      onConnectRef.current?.(socket);
    });
    // Sent right before the server drops this socket; it won't auto-reconnect afterwards.
    socket.on("kicked", () => {
      kicked = true;
      onKickedRef.current?.();
    });
    socket.on("disconnect", (reason) => {
      if (kicked)
        setConn({ status: "closed", error: "You were removed from the game." });
      else if (reason === "io server disconnect")
        setConn({
          status: "closed",
          error: "The server closed this connection.",
        });
      else if (reason !== "io client disconnect")
        setConn({ status: "reconnecting" });
    });
    socket.on("connect_error", (e: Error) => {
      // socket.active is false when the server rejected the handshake (e.g. bad key): no auto-retry.
      const message = e.message || "Unable to reach the game server";
      setConn(
        socket.active
          ? { status: "error", error: message }
          : { status: "closed", error: message },
      );
    });
    socket.on("state", (s: GameState) => {
      if (typeof s?.version !== "number" || s.version < lastVersion) return;
      lastVersion = s.version;
      if (!synced && typeof s.serverNow === "number")
        setOffset(s.serverNow - Date.now());
      setState(s);
    });
    socket.on("grade:queue", (q: GradeQueue | null) => setQueue(q ?? null));

    const iv = window.setInterval(() => socket.connected && syncClock(), 30000);
    return () => {
      window.clearInterval(iv);
      socket.removeAllListeners();
      socket.close();
      socketRef.current = null;
    };
  }, [role, key]);

  const emit: Emit = useCallback(
    <T>(event: string, payload: unknown) =>
      new Promise<Ack<T>>((resolve) => {
        const socket = socketRef.current;
        if (!socket || !socket.connected)
          return resolve({ ok: false, error: "Not connected to the server" });
        socket
          .timeout(ACK_TIMEOUT)
          .emit(event, payload, (err: Error | null, res?: Ack<T>) => {
            if (err)
              resolve({
                ok: false,
                error: "The server did not respond. Try again.",
              });
            else
              resolve(
                res ?? { ok: false, error: "Empty response from server" },
              );
          });
      }),
    [],
  );

  // Also cycles a still-open socket, so the server sees a fresh connection (e.g. after a kick without disconnect).
  const reconnect = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;
    setConn({ status: "connecting" });
    if (socket.connected) socket.disconnect();
    socket.connect();
  }, []);

  return { state, queue, conn, offset, emit, reconnect };
}

export const urlKey = () =>
  new URLSearchParams(window.location.search).get("key");
