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
| Change the reflection prompt or schema | Run `packages/agent/tests/memory/test_reflection.py`; the prompt and `_ReflectionFinding` must name the same fields | The pass parses nothing and silently records zero findings |
