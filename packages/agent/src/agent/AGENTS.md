# The agent: `packages/agent/src/agent`

The Python agent, stateless per turn. Each rule below is explained, with what it
protects, in [`agent-package.md`](../../../../docs/architecture/agent-package.md).

## The trap

Pytest puts only this checkout's `agent` and `agent_host` first on the path; the
other workspace packages come from the checkout that built the venv. Give a
worktree its own venv (`UV_LINK_MODE=copy uv sync --group dev`) before trusting
a test run ([gotchas](../../../../docs/contributing/gotchas.md)).

## Rules

- Nothing under `agent` imports `agent_host`; take the capability as a parameter
  instead (the `agent-api-seam` import-linter contract).
- Call the BFF only through `common/bff_http.py` (`test_bff_http_ratchet.py`), and
  a model only through `common/openrouter.py` (`test_openrouter_call_sites.py`).
- Keep per-turn state in a `ContextVar` registry bound per turn, as
  `cards/registry.py` does; module-level state may hold no tenant or turn data.
- A pydantic type carried in `ConversationState` is listed in
  `_build_checkpointer_serde` (`common/__init__.py`), or a checkpoint restores it
  as a plain dict.
- A grounding-block field goes on `GroundingHit`, its line in
  `render_grounding_block`, its read-back in `citations/extraction.py`
  (`test_grounding_block.py`, `test_citation_pipeline_contract.py`). A tool that
  answers in that grammar also registers with `citations/text_parsers.py`, or a
  replayed turn loses its citations.
- A cited passage's role, edition or date comes from `GroundingHit.work_id` /
  `edition_id`, never from a URL, host or file name (`tests/citations/test_roles.py`).
- A licensed passage's text is printed only by `render_grounding_block`
  (`test_licensed_seam.py`, ADR-0164).
- A measurement is not a source: it travels `tools/bim/measurement_sources.py`,
  never the `SourceRegistry` (the header of `common/source_kinds.py`).
- A new `JobState` or `FileStatus` value gets a branch in every workspace reader
  [listed here](../../../../docs/architecture/agent-package.md#the-seams-one-per-change);
  the BFF's readers have no test.
- Bound every prompt block built from rows, and say so in its text
  (`render_inventory_block`).
- Decide the answer's language from the newest user message
  (`common/question_language.py`), not from the system prompt.
