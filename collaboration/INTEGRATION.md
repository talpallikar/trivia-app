# Integration record

Codex led architecture, the server/engine, shared question validation, persistence, role filtering, testing, packaging and documentation. Claude implemented the frontend under the API contract in CLAUDE-TASK.md, then addressed the targeted fixes in CLAUDE-FOLLOWUP.md and drafted the tester guide. Codex reviewed and corrected the guide against the actual game flow.

## Delivery

- All four required question types and roles, rounds, local media, server timing, bulk/individual grading, auto-match, featured answers, kick/score adjustment and current-question regrading.
- Durable atomic snapshots with acknowledgement after save; timed questions restore paused. Score totals are derived from graded answers plus adjustments.
- Shared client/server view types in src/shared/protocol.ts. Answer IDs and per-answer grades are included in the private grading queue.
- Sample question set, developer README, Dockerfile, nontechnical TESTING.md, cross-platform tester launchers and a distributable ZIP.
- Optional numeric questions, teams, sounds and streak bonuses are out of scope for this implementation.

## Verification

- 11 passing engine/socket integration tests, including active snapshot restoration.
- Production TypeScript/Vite build passes.
- Browser test completes all four sample questions across display/host/player/grader. Verifies pause, refresh, draft recovery, grading/regrading, partial credit, featured-answer privacy and final results. No browser page errors.
- First-run launcher download, official SHA-256 verification and startup exercised successfully on Linux. Official checksum manifest also confirms the Windows x64 and both Mac runtime filenames.
- Packaged build tested in a browser without TypeScript/build tools in its production dependencies: private setup route, valid host access, player join, and no public access to questions/secrets.
- 60-player durable-snapshot rehearsal: 120/120 answers, ten identity reconnects, 19,265 snapshots received, p95 broadcast 342 ms and p95 ack 449 ms after shared ranking optimization. Local machine measurement only.
- Dependency audit reported zero known vulnerabilities after upgrading @fastify/static to 10.1.4.

## Remaining external checks

Windows/macOS launcher execution and actual iPhone/Android/venue-network testing require those devices. No public hosting account or deployment destination has been supplied, so no public instance was provisioned. The tester ZIP is the distributable fallback: extract and double-click, first launch downloads a verified Node runtime, phones share the computer's Wi-Fi.

## Handoff corrections

Claude's result notes reflect the files visible when each delegated task ran. The server now exists, compilation and browser tests pass, queue answers include grade, and the tester guide covers the ZIP as well as hosted links. Host is explicitly authorized for grading/regrading; player/display snapshots never contain other players' raw answers before reveal. Unstarred text is never sent to the projector.
