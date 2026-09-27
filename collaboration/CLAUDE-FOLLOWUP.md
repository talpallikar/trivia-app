# Frontend integration follow-up

The frontend passes TypeScript checks. Server and ten tests now implemented. Please make these specific changes in src/client only, update CLAUDE-RESULT.md, do not touch server/config. No subagents or connectors.

1. Final display currently truncates after place 23; show the full list per design (scrollable if needed).
2. Handle explicit socket event `kicked`: clear partyTrivia.token, clear player identity, show removed message, prevent stale answer UI. Server emits this then disconnects. You may add optional useGame callback for it, or arrange a custom callback via onConnect in Play. Avoid reopening unjoined form on same kicked socket; allow reconnect/join.
3. Queue answers now will include `grade: Grade` (server addition by Codex); show individual grade and aria-pressed in expanded mixed groups.
4. Review reconnect flow and fix any bugs you find. Consolidate shared contract: move src/client/types.ts to src/shared/protocol.ts and re-export from src/client/types.ts, server will use it for compile-time return types. This shared file is explicitly authorized for this followup.
5. Prevent grading action on pointer cancellation (currently onPointerCancel calls onPointerEnd, so a cancelled scroll can grade accidentally).
   Record exact edits and remaining concerns in collaboration/CLAUDE-RESULT.md. You need no shell commands for this task.
