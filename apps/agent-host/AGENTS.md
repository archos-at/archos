# The API plugin: `apps/agent-host`

The backend's FastAPI front end (REST, the job API with SSE, `/v1/ingest`), and the backend image.

Each rule in full, with its reason: [`README.md`](README.md#rules-of-this-tier-in-full).

- Mount a route under `routes/` in exactly one role's list in `plugin.py` (`api_routers` /
  `API_APP_REGISTRARS` for `api`, `CHAT_ROUTERS` for `chat`). `tests/test_roles.py`.
- Type a URL field this tier fetches as `ObjectStoreUrl` (`object_store_url.py`), or name it
  in `NOT_REQUESTED`. `tests/test_route_url_fields.py`.
- Resolve the JWT validator from the `agent_host.validators` entry point, never by import (ADR-0002).
- Decide access in the BFF. This tier validates the token and trusts the context headers.
- Emit a job phase through `jobs/phase_events.py`, and store a payload through `jobs/payload_crypto.py`.
- Name a removed `run_agent_job` parameter in `RETIRED_PAYLOAD_KEYS` (`jobs/worker.py`).
  `tests/test_retired_payload_keys.py`.
- Run research only through `jobs/submit.py` and the `research-run` task. `tests/test_research_workflow.py`.
- Add background work as a Hatchet task (ADR-0150). A task's input holds ids and ciphertext,
  and it raises to Hatchet `from None`.
- Let a full cluster queue a research job: the one 429 is `MAX_QUEUED_JOBS_PER_ORG`.
- Verify and forward the BFF's request envelope; never build, sign or log one (ADR-0108).

Before you change how a background run starts, retries or ends, read
[`docs/deployment/hatchet.md`](../../docs/deployment/hatchet.md) and ADR-0150.
