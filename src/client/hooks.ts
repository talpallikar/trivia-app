import { useEffect, useRef, useState } from "react";
import type { GameState } from "./types";

/** Milliseconds left on the current question, using the server clock offset; null when no timer applies. */
export function useRemaining(
  state: GameState | null,
  offset: number,
): number | null {
  const [now, setNow] = useState(() => Date.now());
  const deadline = state?.deadline ?? null;
  useEffect(() => {
    if (deadline == null) return;
    setNow(Date.now());
    const iv = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(iv);
  }, [deadline]);
  if (!state) return null;
  if (deadline != null) return Math.max(0, deadline - (now + offset));
  if (state.remainingMs != null) return state.remainingMs;
  return null;
}

/** Keeps the screen awake while `active`; silently does nothing where the API is missing or denied. */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const request = async () => {
      if (document.visibilityState !== "visible" || (lock && !lock.released))
        return;
      try {
        const next = await navigator.wakeLock.request("screen");
        if (cancelled) void next.release().catch(() => {});
        else lock = next;
      } catch {
        // Low battery, unsupported context, or permission denied: carry on without it.
      }
    };
    const onVisible = () => void request();
    void request();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => {});
    };
  }, [active]);
}

/**
 * Rank each player held when the current question opened, so the leaderboard
 * can show movement arrows. Empty when the page loaded mid-leaderboard.
 */
export function useRankBaseline(state: GameState | null): Map<string, number> {
  const baseline = useRef(new Map<string, number>());
  const questionKey = useRef("");
  if (state && (state.phase === "question" || state.phase === "roundIntro")) {
    const key = `${state.roundIdx}:${state.questionIdx}:${state.phase}`;
    if (key !== questionKey.current) {
      questionKey.current = key;
      baseline.current = new Map(state.leaderboard.map((e) => [e.id, e.rank]));
    }
  }
  return baseline.current;
}

export function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSet(key: string, value: string | null) {
  try {
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Private mode or storage full: rejoin/drafts just won't persist.
  }
}
