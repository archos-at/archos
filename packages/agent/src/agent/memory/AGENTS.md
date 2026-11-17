# Memory: `packages/agent/src/agent/memory`

The two agent-side writers of durable findings: the `remember` tool and the
reflection pass. Every rule below is explained in
[`project-memory-design.md` §13](../../../../../docs/architecture/project-memory-design.md#13-the-agent-side-writers-packagesagentsrcagentmemory).

- Every write goes through the token-guarded internal BFF endpoint, never a
  database connection (ADR-0003).
- Reflection never writes organization scope; only the tool escalates.
- A finding about the person goes to personal memory (ADR-0180), or is dropped,
  never moved to the project. A personal note is never restricted, never a
  proposal card, never on the stage's frame.
- A personal note is corrected by removing it (`supersedes`, the forget route),
  never by a contradicting note; nothing is written unless the old note is gone.
- A temporary conversation keeps nothing: the tool checks `turn_is_temporary`,
  the stage skips with `temporary_conversation`.
- Every restricted-folder decision is made in `restriction.py`; a restricted
  finding is project memory and never a `memory_proposal` card (ADR-0087).
- A supersede quotes one complete digest entry; the BFF matches it fuzzily.
- Drop a finding in `_finding_from_entry`, before the `MAX_NEW_ITEMS` slice.
- A new frame-item field goes in `TurnMemoryNote.frame_item`,
  `MemoryReflectionItem` and `sanitizeMemoryReflectionStage`, absent for its
  default (`test_memory_reflection_stage.py`, `message-stages.spec.ts`).
- A new project or organization writer writes through `insert_memory_item` under
  a bound memory log, or the note shows under no answer.
- The reflection prompt and `_ReflectionFinding` name the same fields
  (`test_reflection.py`); a mismatch silently records zero findings.
- Before you change the reflection prompt, the tool's description or the
  personal-data filter, run `task be:eval:memory-shelves` before and after.
- A note states the preference itself, with no name or third person; a state of
  the workspace is never a finding (`TestReflectionSystemPrompt`).
