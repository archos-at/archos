# The BIM surface: `packages/agent/src/agent/tools/bim`

Two tools over the project's IFC model, not an agent. `register.py` is
`ifc_query` — a structured read of the extracted index, answering what the
export *wrote down*. `measure_register.py` is `ifc_measure` — the spatial
engine over the model's own bytes, answering what it did not.

## The invariants

**Every number keeps the verb it was got by.** `deklariert` (the file says so),
`gemessen (±tol)` (we measured it), `vermutlich` (a heuristic, with its
confidence). Collapsing them into one figure is how a guess gets stamped as a
fact; the provenance is the audit trail that replaces a quotation.

**`decidable: false` is an answer, not an error.** The question was well formed
and this export cannot answer it. Say what is missing and what the architect
changes in their CAD (`missing.remedy`); do not fall back to a guess.

**The vocabulary is also taught to the model.** `VALID_OPERATIONS`, `MEASURES`,
`KINDS`, `RELATIONS` and their siblings are pinned by the `ifc-spatial-reasoning`
skill, which routes between the two tools by operation name. A skill naming a
call that cannot be made costs the reader a whole turn.

## Obligations

| When you | You must | What fails you |
|---|---|---|
| Add, rename or drop an operation or an enum value | Update `packages/agent/src/agent/skills/builtin/bim/ifc-spatial-reasoning/SKILL.md`, on the side of the routing table that really has it | `packages/agent/tests/skills/test_ifc_spatial_skill.py` |
| Reword a field or enum description (`measure_input.py`, `measure_vocab.py`) | Regenerate `apps/workspace/tests/fixtures/backend-tools.schema.json` (`scripts/generate_backend_tools_schema.py`): the MCP door serves these descriptions to outside agents with `ENGLISH_GLOSSES` (`apps/workspace/bff/agent-api/backend-operations.ts`) applied, phrase by phrase. A German term must stay inside a phrase a gloss matches (`a Wendekreis check`, not a bare `Wendekreis`), and a gloss nothing matches any more is deleted | `bff/agent-api/english-only.spec.ts` for a German term no gloss covers; `packages/agent/tests/common/test_backend_tools_schema.py` for a stale fixture. Nothing for a dead gloss |
| Record a capability gap | Only for a value in no vocabulary, and only a name-shaped one — never for `decidable: false` or a bad GlobalId, and never in a way that can fail a working measurement | Nothing. A ledger that logs every refusal is a log nobody reads |
