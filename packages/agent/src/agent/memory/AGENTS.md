# Memory: `packages/agent/src/agent/memory`

The two agent-side writers of durable findings, a project's and a person's: the in-turn
`remember` tool (`register.py`) and the body of the post-answer reflection pass
(`reflection.py`), plus the one decision both make about restricted folders
(`restriction.py`). Not an agent — one agent tool and one stage handler.

Do not confuse it with `agent/knowledge/project_memory.py` and
`agent/knowledge/personal_memory.py`, which are the HTTP clients both use, or with `agent/stages/memory_reflection.py`, which
declares when the stage runs. This package holds only what a memory *is*.

## The invariants

**The backend never writes the app database.** Every write goes through the
token-guarded internal BFF endpoint, so `app` stays single-writer
(ADR-0003). A new write path is a new call to that endpoint, not a new
connection.

**Reflection never writes organization scope.** The tool may escalate a
scopeless project write to the organization; reflection never does. A wrong
firm-wide finding poisons every project in the org, and no human saw this one.

**A finding about the person goes to personal memory, never to the project's
(ADR-0180).** The tool takes it as scope `personal`; reflection as
`about: person`. Both write through `knowledge/personal_memory.py` with the
turn's signed envelope (the BFF takes the owner from it), and without an
envelope the finding is dropped, not moved to the project. A reflection
`preference` with no usable `about` is dropped: a personal note on the team's
shelf is the harm, a lost note is not. A personal note is never restricted
memory, never a proposal card, and never on the stage's frame, which is stored
on a message other people read. Project and organization writes keep the whole
personal-data denylist (`looks_like_personal_data`); personal writes keep its
secret half (`looks_like_secret`).

**The stage's frame lists the turn's shared notes, and only those.** The
`memory_reflection` frame carries the project and organization notes the
`remember` tool created during the answer (`provenance: "agent"`, at most
`MAX_NOTED_ITEMS`, first) and the ones reflection created after it. An item may
add `scope: "organization"`, `supersedes` and `restricted: true`; each is absent
for its default, so build an item with `TurnMemoryNote.frame_item`. A note the
BFF only refreshed (`created: false`) is left off, because the chip's remove
action would delete a note this turn did not write. The stage's gate proceeds
for a turn with in-turn notes even where reflection is declined, and the handler
then reports them without a model call. The frame reaches the message through
the browser (`sanitizeStages` in `apps/workspace/bff/conversations/message-stages.ts`
bounds it), so it is a notice of the write and never the record of it.

**The turn's memory log is where a write becomes a note of the turn.**
`_record_write` in `knowledge/project_memory.py` reads the BFF's answer:
`created` decides between `notes` and `refreshed`, and `supersededId` decides
whether the note counts as a replacement. `turn/registries.py` hands the log's
notes to the stage as `TurnFacts.noted_this_turn`; reflection writes under a
log of its own (`_reflected_items`).

**A note is tied to its answer by the answer message id.** That id is
`turn.response.answer_message_id`, a `uuid5` over the conversation and the user
message that opened the turn. The chat agent binds it on the memory log, the
reflection stage derives it again, and the browser holds it as the answer's
message id. A personal write sends it as `sourceMessageId`
(`personal_memory.source_message_id`), and the owner's browser reads its own
notes of the conversation and shows each under the answer with that id. The
signed envelope names the conversation and no turn, so the BFF cannot check the
id. It only chooses under which of the owner's own answers their own note shows.
Off the chat socket (a research run) there is no id and the note belongs to no
answer.

**A temporary conversation keeps nothing (ADR-0180).** The flag arrives with
the turn context. The tool reads it off the turn's memory log
(`turn_is_temporary`) and answers without calling the BFF; the stage's gate
skips with `temporary_conversation`. The BFF refuses the write too
(`TEMPORARY_CONVERSATION`), and that refusal maps to the same tool result.

**A memory from a turn with restricted folders in scope is decided in
`restriction.py`, and nowhere else.** Both writers call
`restriction_decisions` (the restriction `decide_restrictions` returns, plus the
judge's verdict, sent with the write so the BFF audits it); every failure
restricts to all of the scope's restricted collections. A
restricted finding is project memory (never organization) and never a
`memory_proposal` card, because accepting a card writes open memory
(ADR-0087, `docs/architecture/project-memory-design.md` §3.6). Its evidence
includes the restricted digest lines EARLIER turns were shown
(`shown_notes.py`, recorded per conversation by `turn/registries.py`): a new
reader of restricted evidence reads that record too, or a note that left the
re-ranked digest is filed open.

**A supersede must quote one COMPLETE entry of the digest the model was
shown.** The frontend resolves supersedes fuzzily (≥0.7 Jaccard), so a
truncated or paraphrased quote would retire an entry nobody named. Reflection
drops the quote and keeps the finding.

## Obligations

| When you | You must | What fails you |
|---|---|---|
| Add a reason a finding is dropped | Drop it in `_finding_from_entry`, before the `MAX_NEW_ITEMS` slice | A rejected finding eats a slot, and the pass records fewer than it found |
| Change what the tool returns to the model | Say plainly whether the item was saved, where, and who can read it; a card shown is not a write | The model tells the reader it remembered something that was never stored |
| Add a field to a frame item | Add it to `TurnMemoryNote.frame_item`, `MemoryReflectionItem` and `sanitizeMemoryReflectionStage` (`message-stages.ts`), as a closed value that is absent for its default | The BFF drops a key it does not know, so the chip never sees the field and nothing reports it. `packages/agent/tests/stages/test_memory_reflection_stage.py`, `message-stages.spec.ts` |
| Add a writer of project or organization memory | Write through `insert_memory_item` under a bound memory log, so `_record_write` enters the note | The note is stored and shows under no answer |
| Change the reflection prompt, the `remember` tool's description or schema, or the personal-data filter | Run `task be:eval:memory-shelves` before and after ([what it measures](../../../../../docs/contributing/testing-and-verification.md#the-memory-shelves-eval)) | Nothing in CI: it needs a provider key. Review |
| Change the reflection prompt or schema | Run `packages/agent/tests/memory/test_reflection.py`; the prompt and `_ReflectionFinding` must name the same fields | The pass parses nothing and silently records zero findings |
