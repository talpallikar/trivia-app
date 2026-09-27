# Party Trivia

A single-server party game with a projector display, phone players, remote host controls, and a separate human grader. Built from [the design document](Party%20Trivia%20App%20%E2%80%94%20Requirements%20%26%20Design.md). Supports multiple choice, true/false, short answer, and free response.

## Download for testing

**[Download Party Trivia for Windows or Mac](https://github.com/talpallikar/trivia-app/releases/latest/download/Party-Trivia-Tester.zip)**

Extract the ZIP and double-click **Start Trivia.bat** (Windows) or **Start Trivia.command** (Mac). First launch needs internet; the browser opens with a guided setup. No development tools are needed. Phones must share the computer’s Wi-Fi. See the [tester guide](TESTING.md) for the 10-minute walkthrough.

## Run locally

Requires Node.js 22 or newer.

```sh
npm ci
npm run build
npm start
```

Open `http://localhost:3000/display`. The server prints secret host and grader links. Without environment keys, fresh random keys are generated each launch; set stable keys before your party. Players join `/play`, with no account. Questions in `questions.json` are example content to replace before the event.

For development, run `PUBLIC_URL=http://localhost:5173 npm run dev` and open port 5173. Vite proxies sockets and media to port 3000. For phones on your Wi-Fi, use your laptop's LAN address in `PUBLIC_URL`, e.g. `http://192.168.1.10:5173`. `localhost` on a phone refers to that phone, not the server. The QR code always uses `PUBLIC_URL`.

Environment variables are read from the process environment; `.env.example` is a reference, not automatically loaded. To load a populated `.env` explicitly with Node:

```sh
node --env-file=.env --import tsx src/server/index.ts
```

| Variable         | Default                 | Purpose                                               |
| ---------------- | ----------------------- | ----------------------------------------------------- |
| `HOST_KEY`       | Random per launch       | Secret host access key; host can also grade           |
| `GRADER_KEY`     | Random per launch       | Separate grading-only key                             |
| `PUBLIC_URL`     | `http://localhost:3000` | Origin guests can reach, used in QR and startup links |
| `PORT`           | `3000`                  | HTTP and Socket.IO port                               |
| `BIND_HOST`      | `0.0.0.0`               | Listening interface                                   |
| `QUESTIONS_FILE` | `questions.json`        | Validated question source                             |
| `SNAPSHOT_FILE`  | `data/state.json`       | Durable private state file                            |
| `NODE_ENV`       | Unset                   | `production` requires keys and `PUBLIC_URL`           |

## Play and grade

1. Open `/display` fullscreen on the TV. Keep the host and grader links off the projector.
2. Guests scan the QR code and enter unique nicknames of 1–16 characters.
3. The host starts the game and opens each round's first question. Timers and answers belong to the server.
4. Choice questions reveal automatically after all eligible players answer or time runs out. Pausing freezes the remaining time and does not penalize answer speed.
5. Text questions wait for grading. The grader sees anonymous answer groups; correct/partial/wrong buttons mark the whole group. Expand a group to grade individuals, or enable names. Stars select answers for the projector; unstarred text stays private.
6. Submit grading to reveal. The host can force reveal, assigning zero to ungraded answers. Current text answers can be regraded during reveal, leaderboard, or final; score adjustments are available throughout.
7. The host advances through leaderboard and rounds to final results. Restart resets answers and scores while keeping player identities.

Players can refresh or reconnect using a local browser token. Late joiners become eligible at the next question. Eligibility is fixed at question open, so phones already offline do not delay the room; a player who disconnects after opening stays eligible until the deadline. Kicking removes that player from eligibility and the leaderboard. Duplicate submissions return success without changing the first answer.

## Author questions

`questions.json` is validated at startup. Invalid files fail with field paths, including duplicate IDs, invalid answer indices, bad time limits and media paths. The answer key is never shipped with the client bundle or publicly served.

```json
{
  "title": "Birthday trivia",
  "defaultTimeLimitSec": { "choice": 20, "text": 45 },
  "rounds": [
    {
      "title": "Round one",
      "questions": [
        {
          "id": "q1",
          "type": "mc",
          "prompt": "Pick a color",
          "options": ["Red", "Blue"],
          "correct": 1
        },
        {
          "id": "q2",
          "type": "tf",
          "prompt": "The Earth is round",
          "correct": true
        },
        {
          "id": "q3",
          "type": "short",
          "prompt": "Capital of France?",
          "answer": "Paris",
          "acceptable": ["Paris"],
          "allowPartial": false
        },
        {
          "id": "q4",
          "type": "free",
          "prompt": "Pitch a flavor",
          "answer": "One point for flavor, one for pitch",
          "allowPartial": true,
          "points": 1500,
          "maxChars": 300
        }
      ]
    }
  ]
}
```

MC has 2–6 options and a zero-based `correct` index. Short answers have a 40-character cap; free responses default to 300 characters. The optional `acceptable` list pre-marks normalized short answers correct. Normalization uses Unicode lowercasing, removes punctuation, trims and collapses whitespace. Partial credit is available only when `allowPartial` is true. All types support `timeLimitSec` (1–600), `points` (default 1000), and an `image` such as `/media/photo.jpg`. Put images in `media/`.

Choice scores fall linearly from full points to half points over the question duration. A 300 ms arrival grace window absorbs jitter, with scores capped at the last-second minimum. Text earns full, half, or zero points without a speed bonus. Scores are recomputed from answers plus explicit host adjustments. Ties break by total choice response time, then nickname for stable ordering.

## Recovery and privacy

Every accepted mutation is saved before acknowledgement using a private, fsynced temporary file and atomic rename. Failed writes roll back the mutation. Restarts restore identities, answers, grades and adjustments; an active timed question restores **paused** with its last persisted remaining time. The host resumes it. An answer whose acknowledgement was lost can safely be retried.

Snapshots are tied to a hash of the validated question file. Startup refuses corrupted snapshots or changed questions instead of silently losing a game. Stop the server and archive or remove the snapshot before changing the question set. Back up the file if results matter.

The snapshot contains nicknames, session tokens, submitted answers and scores needed for recovery. Treat it and the host/grader URLs as private. After the party, stop the server and remove `data/state.json` (and any backups). Players can clear browser site data to remove their token and drafts. No analytics or external font requests are used. Use HTTPS outside a trusted LAN; wake lock is best-effort and requires a supported browser/secure context.

## Deploy

A Dockerfile is included:

```sh
docker build -t party-trivia .
docker run --rm -p 3000:3000 \
  -e NODE_ENV=production \
  -e HOST_KEY=your-long-random-host-key \
  -e GRADER_KEY=your-different-long-random-grader-key \
  -e PUBLIC_URL=https://trivia.example.com \
  -v trivia-data:/app/data party-trivia
```

Run exactly **one always-on instance**, with persistent storage mounted at `/app/data`. Put an HTTPS reverse proxy in front that supports WebSocket upgrades, and route HTTP and sockets to the same instance. `/health` is the health check. Do not enable scale-to-zero or multiple replicas. Startup logs contain privileged links; keep log access private. You can bind-mount your question file and media directory when deploying. No cloud deployment is performed by this repository.

## Verify

```sh
npm test
npm run build
npx playwright install chromium --only-shell
npm run test:browser
npm run load-test
```

Unit and socket integration tests cover state transitions, schema errors, auth, scoring, pause/grace boundaries, answer privacy, bulk grading, regrading, reconnects and snapshots. The browser test plays all four question types through all four routes, including refresh, draft recovery, grading persistence and featured answers. Screenshots are written to `test-results/`.

The isolated load rehearsal starts its own temporary server, uses durable snapshots, runs 60 simultaneous players through choice and text questions, then reconnects ten. It verifies answer counts and fails if local p95 broadcast latency reaches 500 ms. This is a local benchmark, not a cellular or venue-network guarantee. Use `PLAYERS=80 npm run load-test` to vary the population.

Before the party, do a full dry run on a real iPhone and Android phone, including screen lock, weak signal and reconnect; confirm the public QR URL, HDMI readability, host/grader bookmarks, persistent disk and sleep settings. Keep a printed QR backup.

## Implementation scope

All MUST features and the SHOULD features (rounds, media, persistence, auto-match, kick/adjust/regrade, featured answers) are implemented. Optional numeric questions, teams, sound/music and streak bonuses are not enabled. Questions are authored in JSON; there is no authoring UI or multi-game hosting.

Codex led the server, integration and verification; Claude implemented the client and targeted follow-up fixes. Task boundaries, API contract and handoffs are in `collaboration/`.

## Give it to a nontechnical tester

Share **`release/Party-Trivia-Tester.zip`**, not the source folder. It contains the built app, dependencies, sample questions, a browser start page, the [10-minute tester guide](TESTING.md), and Windows/Mac launchers. The tester extracts the ZIP and double-clicks their launcher. First launch automatically downloads and verifies a pinned Node runtime; no Node installation, npm commands or build steps are needed. The launcher's status window stays open while the game runs.

To regenerate the ZIP on a developer machine (Node, npm and Python 3 required):

```sh
npm run package:tester
```

Packaging uses npm's local cache in offline mode; run `npm ci` once first if needed. It never copies game state, access keys, `.env`, or your runtime cache into the archive. Windows x64 and both Mac architectures are supported by the launchers; Linux can run the `.command` script with Bash. These are unsigned scripts, so OS security settings may require help from the sender. Windows/macOS launcher behavior still needs a real-device check.

The start page opens automatically and provides Display, Host, Player and Grader buttons. It detects a local network address for the QR. Phones must share the computer's Wi-Fi, and the computer must stay on. VPNs, guest-network isolation or firewall settings can prevent phone access; separate tabs on the same computer are an alternative.

For a tester on a different network or the least possible setup, deploy the Docker image to your own always-on HTTPS server and send the working display/host/grader links with `TESTING.md`. A public hosted instance has not been provisioned.
