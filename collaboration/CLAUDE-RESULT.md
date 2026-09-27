# Claude result: frontend implementation

## Follow-up (CLAUDE-FOLLOWUP.md): changes made

I made these changes by hand. I tried to run `npx tsc --noEmit` afterwards, but the command wasn't approved, so **none of them are type-checked yet. Please run `npm run build`.** Nothing under `src/server/` or in the config files was touched.

1. **Final display shows every player**
   - `routes/Display.tsx`: `leaderboard.slice(3, 23)` is now `leaderboard.slice(3)`.
   - `styles.css` `.final-rest`: replaced `overflow: hidden` with `overflow-y: auto; min-height: 0; flex: 0 1 auto; align-content: start; overscroll-behavior: contain`. The list now scrolls inside the flex column instead of being clipped.
2. **`kicked` event**
   - `socket.ts`: `useGame` has a new optional 4th argument, `onKicked`, stored in a ref like `onConnect`. On `kicked`, the socket gets a per-socket `kicked` flag (reset on `connect`) and the callback runs.
   - `socket.ts`, the disconnect that follows a kick: the banner now says "You were removed from the game." instead of the generic server-closed text.
   - `routes/Play.tsx`: there is a new session state `'kicked'`. `onKicked` does the following:
     - clears `partyTrivia.token`, `joinedRef` and `sawMeRef`
     - bumps the rejoin attempt counter
     - sets `session='kicked'` and a removed notice
   - While kicked, the player sees a "You were removed" screen with a **Join again** button, and no `PlayerPhase` or `JoinForm` is rendered, so no stale answer UI.
   - The banner's Reconnect button is hidden while kicked, so the screen only has one action.
   - **Join again** calls `reconnect()`. The new connection has no token, so `onConnect` switches to `session='none'` and shows the join form on a **fresh** socket.
   - The older "`me` disappeared" check now just calls `onKicked()` as a fallback, instead of opening the join form on the same socket.
   - `socket.ts` `reconnect()`: if the socket is still connected, it now calls `disconnect()` then `connect()`. This means Join again always gets a new server socket (no leftover `socket.data.playerId`, so the server won't answer "Already joined"), even when the fallback path fired without a server disconnect.
3. **Per-answer grades in expanded groups** (`GradeQueue.tsx`, `styles.css`)
   - Each expanded answer's ✓/½/✗ mini buttons now have `aria-pressed={a.grade === g}` and an `active` class. They're filled like the group buttons via new `.mini-btn.gb-*.active` rules.
   - A grade chip appears next to an answer when its grade differs from the group's, which in practice means in mixed groups.
4. **Reconnect review and shared contract**
   - **Contract moved:** it now lives in `src/shared/protocol.ts` (types only, no runtime imports). `QueueAnswer` gains `grade: Grade`. `src/client/types.ts` is now just `export type * from '../shared/protocol'` (needs TS ≥ 5.0; the repo has ^5.7). No client imports changed.
   - **Bug fixed, stale rejoin replies/retries:** each `onConnect` bumps `attemptRef`. A rejoin ack or 1.5 s retry from an earlier connection (or from before a kick) is now ignored. Before, a slow ack from a dropped connection could flip the session, or its retry could send a duplicate `rejoin` alongside the new connection's.
   - **Bug fixed, transient rejoin rejections dropped the token:** a rate-limit rejection (`Too many requests; try again`) used to clear the token and force a new nickname. Rejections matching `/too many requests|try again/i` now keep the token and retry like a timeout. All other rejections still clear it.
5. **Pointer cancel** (`GradeQueue.tsx`): `onPointerCancel` now uses its own handler. It resets the swipe start and offset without grading, so a scroll the browser takes over can no longer mark a group correct or wrong.

### Remaining concerns

- **Per-answer `grade` is missing on the server:** `src/server/engine.ts` `queue()` currently builds answers as `{id,text,featured,nickname?}`, without `grade`. The contract now requires it. Until Codex adds `grade: a.grade`, the server won't satisfy the shared type if it's typed against it. The UI tolerates the field being missing: nothing is pressed and no chip is shown.
- **Server imports:** the server uses `.js` import suffixes. It should use `import type { … } from '../shared/protocol.js'`.
- **Kick ordering:** `host:adjust {kick}` broadcasts `state` (still containing `me` for the kicked socket, because `view()` doesn't check `p.kicked`) and only then emits `kicked`. The client handles this ordering, but `view()` could skip kicked players for clarity.
- **Transient-error detection matches the server's error text.** A machine-readable error code in acks would be sturdier.
- **"Rejoining…" flicker:** every reconnect briefly shows "Rejoining…", which unmounts the answer UI. Text drafts are saved, but the input loses focus. I left this alone, because keeping the UI up during rejoin would let answers fail with "Join before answering".
- **Final list on a projector:** a very long final list now scrolls, but nobody scrolls a projector. If that matters, an auto-scroll or multi-column paging could be added later.

## Status

All four routes are implemented under `src/client/**`. I touched nothing outside `src/client/` apart from this file.

**Not verified:** I couldn't run `tsc --noEmit` or `vite build` in my session because the command permission prompts were declined. I also couldn't run the app end to end, because `src/server/index.ts` doesn't exist yet. Instead I checked the code by hand against the contract and against `src/server/engine.ts` (`view()` / `queue()`). **Please run `npm run build` first and send me any errors.**

## Files

| File                                                      | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `main.tsx`                                                | Entry point and pathname router. `/` and unknown paths are rewritten to `/play` (query string kept). Adds `body.is-display` on `/display`.                                                                                                                                                                                                                                                                                                                                                                                                 |
| `types.ts`                                                | Re-exports the socket contract types from `src/shared/protocol.ts` (moved there in the follow-up).                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `socket.ts`                                               | `useGame(role, key, onConnect?)`: one socket.io connection (same origin, `auth:{role,key}`). It tracks the latest `state` (drops older `version`s, resets the version floor on every `connect`), `grade:queue`, connection status (connecting / reconnecting / error / closed) and clock offset. The offset comes from a round-trip `clock` call on connect and every 30 s; `serverNow` from `state` is the fallback until that returns. `emit()` is a promise-wrapped ack with an 8 s timeout that returns `{ok:false,error}` on timeout. |
| `hooks.ts`                                                | `useRemaining` (deadline minus server-adjusted now, or `remainingMs` when paused), `useWakeLock` (re-requests on `visibilitychange`, fails silently), `useRankBaseline` (ranks when each question opens, used for leaderboard arrows), and safe localStorage helpers.                                                                                                                                                                                                                                                                      |
| `ui.tsx`                                                  | Shared pieces: shapes (triangle, diamond, circle, square, star, hexagon) with letters A–F, countdown ring, QR code (via `qrcode`, `joinUrl` from the server only), connection banner, leaderboard, podium, progress bar, key gate, helpers.                                                                                                                                                                                                                                                                                                |
| `GradeQueue.tsx`                                          | Grading UI used by `/grade` and by `/host` for regrading.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `routes/Display.tsx`, `Play.tsx`, `Host.tsx`, `Grade.tsx` | The four routes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `styles.css`                                              | Warm dark theme, bold type, mobile-first layout, projector sizing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## How the requirements are met

- **Display**
  - **Lobby:** QR code, short URL and nickname chips (disconnected players dimmed).
  - **Round intro:** title card.
  - **Question:** the prompt is `clamp(48px, 4.4vw, 100px)`, so it never drops below 48 px. Also shows the image, options with shape, letter and colour, a countdown ring, "X / Y answered" and a Paused overlay. Text questions get a note that unsent drafts don't count.
  - **Grading:** a neutral "Judging in progress" screen with a progress bar and no answer text.
  - **Reveal:** answer key plus distribution bars (MC/TF), or up to 3 featured answers with nicknames (text).
  - **Leaderboard:** top 10 with ▲/▼ movement arrows.
  - **Final:** podium plus every remaining place (scrollable).
- **Player**
  - **Rejoin:** the token is stored in localStorage (`partyTrivia.token`) and sent with `rejoin` on every connect. If the server rejects it, the token is cleared and a notice is shown; if the server doesn't reply, the client keeps the token and retries.
  - **Kick detection:** the `kicked` event, or as a fallback `me` disappearing after this connection has seen it, clears the token and shows a "You were removed" screen with a Join again button (which opens a fresh socket).
  - **Nickname:** 1–16 characters.
  - **Answering:** MC/TF are one-tap buttons with shapes and letters (tall touch targets). Text uses an input or textarea with a character counter and a Send button.
  - **Drafts:** saved per question under `partyTrivia.draft.<questionId>` and restored on reload. Drafts from earlier questions are deleted.
  - **Other states:** locked-in / sent view (own answer shown back), late joiner (`!me.eligible`), paused, time's up.
  - **Reveal:** green/amber/red result with points, rank and answer key. Leaderboard and final phases show rank and score. The wake lock is held while joined.
- **Host**
  - **Key:** prompts for the key if `?key=` is missing, then writes it into the URL.
  - **Controls change by phase:** start / open question / pause / resume / skip / force reveal / show leaderboard / next question or final results / end / restart.
  - **Confirmations:** end, skip, restart, kick, force reveal with ungraded answers, and starting with 0 players.
  - **Players:** list with online dot, ±100/±500 buttons, custom delta, and kick.
  - **Regrading:** a collapsible panel reuses `GradeQueue` (hidden by default because it shows raw text).
  - **Links:** "Open display", "Grade on this device" (`/grade?key=<hostKey>`, which relies on the server accepting the host key for the grader role), and a "grader link for a friend" builder where you type the separate grader key.
- **Grader**
  - Shows a key gate if the key is missing.
  - The question prompt and official answer stay pinned at the top.
  - Answers are grouped with a ×N count. One tap grades a whole group; the Partial button only appears when `allowPartial` is set. Swiping right marks correct, swiping left marks wrong.
  - Groups can be expanded to grade or star individual answers. Single answers can be starred directly.
  - Auto-matched correct groups are folded into a collapsed section.
  - The names toggle sends `grade:names {show}`. Its on/off state is worked out from whether the queue includes nicknames.
  - Submit shows the ungraded count and asks for confirmation before sending `force:true`. After reveal, a "Regrading" notice replaces the submit button.
- **Connection errors:** a sticky banner shows connecting / reconnecting / error messages. A server-side disconnect or a rejected handshake (e.g. bad key) offers a Reconnect button. `state.error` is shown in the same banner.

## Assumptions for Codex's server

1. **`state` goes to every role, including grader.** Grader uses it only for the phase label and to hide Submit outside the grading phase. Without it, Submit stays visible whenever a queue exists.
2. **`grade:names` returns an ack** (`{ok:true}`), like the other events. Without one, the client shows a timeout error after 8 s, and the toggle state can only update from the queue.
3. **Host sockets can send `grade:set` and `grade:feature`** for regrading. The host panel doesn't show a Submit button; the host uses `forceReveal` instead.
4. **Kicked players:** either the server stops including `me` in that player's state, or it disconnects them and the next `rejoin` fails. The client handles both. If the server calls `socket.disconnect()`, the player sees a Reconnect button rather than an automatic retry.
5. **Rejoin ack:** if it includes `token`, the stored token is refreshed.
6. **TF answers:** the answer key is compared case-insensitively to `'true'`/`'false'` (the engine sends `String(correct)`). Distribution index 0 is True, index 1 is False. The player sends `choice: true/false`.
7. **Serving:** the SPA needs history fallback for `/display`, `/play`, `/host` and `/grade` (serve `index.html`), and `/media/*` must be served for question images.
8. **`qrcode` is imported as `import { toDataURL } from 'qrcode'`** (named import; its typings have no default export).

## Known gaps / follow-ups

- Not type-checked or run yet (see Status).
- ~~Per-answer grades inside a mixed group aren't shown~~: done in the follow-up, but it needs the server to send `grade` on each queue answer.
- In dev, React StrictMode opens and immediately closes an extra socket on mount. This is harmless and doesn't happen in production builds.

## Tester guide (CLAUDE-TESTER-TASK.md)

- Added `TESTING.md` at the repository root. It is a one-page, plain-language guide for a nontechnical tester who has been given working display, host and grader links. No source code was changed.
- It covers:
  - The roles of the three links, and keeping the host and grader links private.
  - Two ways to use devices: scanning the QR code with a phone, or using separate tabs on one computer. Tabs in the same browser count as one player; an extra player needs a private window or a second phone.
  - A 10-minute walkthrough of the four sample questions from `questions.json`, with their answers.
  - Pause and resume, refreshing and rejoining on the phone, and grading with Correct, Partial and Wrong.
  - Starring answers for the projector, Final results, and Restart game.
  - Optional extra checks, and a checklist for reporting issues: device and browser, screen, action, expected result and actual result.
- On networks, it only says that online-hosted links work over mobile data, while a local package needs the same Wi-Fi. There are no setup instructions, because Codex is still deciding packaging and hosting. The guide says clearly that real-device and real-network testing has not been confirmed yet.
- Button labels come from `Host.tsx`, `Play.tsx`, `GradeQueue.tsx` and `Display.tsx`. The round flow was checked in the engine: a new round goes to the round intro, then Open question.
- If the packaging changes the join URL or how the links are delivered, update the "What you'll receive" and "Will phones connect?" parts.
