# The backend suite: `tests/`

Repo-level tests: guards, CI, deploy and cross-service contract fixtures. The agent's own
suite lives in `packages/agent/tests`, mirroring `packages/agent/src/agent`. `task be:test`
runs both (and `evals/`); `task be:test:ci` adds CI's 65% coverage floor on
`packages/agent/src/agent`. One area: `.venv/bin/pytest packages/agent/tests/cards`.

## How the suite is set up

| Thing | How it works here |
|---|---|
| Which code is tested | `pyproject.toml` puts this checkout's `packages/agent/src/` (and `apps/agent-host/src`) ahead of the venv's editable install. The other workspace packages, `knowledge_layer` among them, come from the checkout the venv was built in ([gotchas](../docs/contributing/gotchas.md)) |
| Async tests | `asyncio_mode = "auto"`, so no `@pytest.mark.asyncio`; the loop is session-scoped |
| Imports | `--import-mode=importlib` with `.`, `packages/agent/src` and the test-support packages on pytest's `pythonpath`, so `from tests.provider_doubles import ...` resolves the same under `pytest`, `python -m pytest` and an IDE runner |
| Helpers another test file needs | In the suite's `<distribution>_testing` package (`agent_testing` in `packages/agent/tests/testing/`, `knowledge_layer_testing`, `ris_adapter_testing`), imported by that name; a conftest only registers its fixtures. A dotted path through a suite directory breaks on a directory move (ADR-0145); `tests/test_test_imports.py` fails it. A module at the top of `tests/` and `tests.fixtures` stay importable as they are |
| Shared doubles | `tests/provider_doubles.py` holds the provider-contract double and the agent runtime's client shape. Extend it rather than re-mocking a provider per file |
| `tests/conftest.py` | Every test under `tests/` loads it, so it imports only what every test needs; a fixture imports a heavy package in its body. `tests/test_import_weight.py` fails a conftest that loads LangChain, the agent runtime, Qdrant or a whole package (`docs/audit/blast-radius-2026-10.md`) |
| Fixtures on disk | `tests/fixtures/<area>/`, real captured payloads rather than hand-written approximations |
| Tenancy | This suite does not exercise row-level security; `task db:test:rls` does |
| A package's own suite | Listed in the three places [`packages/AGENTS.md`](../packages/AGENTS.md) names, without a `tests/__init__.py` |

Assert an LLM call's contract (tools bound, prompt block present, bounds respected), not its
prose: a wording test fails the day the model rewords.

The whole gate, CI's sharding and the security stack:
[`testing-and-verification.md`](../docs/contributing/testing-and-verification.md).
