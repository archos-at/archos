# Agent host API

Unified API plugin for the agent host: **Knowledge API** (collections, documents) and **Async Job API** (agent-agnostic jobs with SSE streaming).

## Quick Start


### Web Mode - Local Development

```bash
# Loads API keys from deploy/.env; the agent runtime auto-creates:
# - SQLite database at .tmp/job_store.db
PROCESS_ROLE=api dotenv -f deploy/.env run nat serve --config configs/config_oib_openrouter.yml
```

`PROCESS_ROLE` is required and has no default (ADR-0082): `api` serves the HTTP routes, `chat` the chat socket (run it on another port beside the `api` process when the UI is in use, as `scripts/start_e2e.sh` does). Ingestion is claimed by `PROCESS_ROLE=ingest-worker python apps/agent-host/entrypoint.py`; without one, set `INGEST_QUEUE=off` and `api` runs ingest jobs itself.

### Production (PostgreSQL)

```bash
export NAT_JOB_STORE_DB_URL="postgresql://user:pass@host:5432/dbname"
PROCESS_ROLE=api dotenv -f deploy/.env run nat serve --config configs/config_oib_openrouter.yml
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                  Agent runtime layer                            │
│                  (Built-in infrastructure)                      │
│                                                                 │
│   nat.front_ends.fastapi/                                       │
│   ├── job_store.py      # JobStore, JobStatus, JobInfo         │
│   ├── async_job.py      # async job patterns                   │
│   └── config.py         # db_url                               │
│                                                                 │
│   Provides: Job tracking, SQLite/PostgreSQL                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Agent host API (extension layer)               │
│                                                                 │
│   apps/agent-host/src/agent_host/                                │
│   ├── jobs/                                                     │
│   │   ├── agent_job.py        # run_agent_job, in phases        │
│   │   ├── submit.py           # submit_agent_job                │
│   │   ├── callbacks.py        # SSE event generation            │
│   │   ├── event_store.py      # Persistent event storage       │
│   │   └── connection_manager.py  # SSE connection lifecycle     │
│   ├── routes/                                                  │
│   │   ├── jobs.py             # /v1/jobs/async (submit, stream) │
│   │   ├── collections.py     # /v1/collections (Knowledge API) │
│   │   └── documents.py       # /v1/documents (upload, ingest)   │
│   ├── models/requests.py     # Pydantic request/response models │
│   ├── registry.py            # Agent type registry              │
│   ├── plugin.py              # FastAPI plugin (AgentHostWorker)│
│   ├── chat_socket.py         # /websocket: the chat wire v2     │
│   ├── conversation_bus.py    # frames between replicas, attach  │
│   └── internal_api.py        # writes into the BFF internal API │
│                                                                 │
│   Provides: Async jobs + SSE streaming, Knowledge API, event replay │
└─────────────────────────────────────────────────────────────────┘
```

## API Routes

Base path: `/v1/jobs/async`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/jobs/async/agents` | GET | List available agent types |
| `/v1/jobs/async/submit` | POST | Submit a new job |
| `/v1/jobs/async/job/{id}` | GET | Get job status |
| `/v1/jobs/async/job/{id}/stream` | GET | SSE stream from beginning |
| `/v1/jobs/async/job/{id}/stream/{last_event_id}` | GET | SSE stream from event ID |
| `/v1/jobs/async/job/{id}/cancel` | POST | Cancel running job |
| `/v1/jobs/async/job/{id}/state` | GET | Get current UI state |
| `/v1/jobs/async/job/{id}/report` | GET | Get final report |

### List Available Agents

```bash
curl http://localhost:8000/v1/jobs/async/agents
```

Response:

```json
{
  "agents": [
    {"agent_type": "deep_researcher", "description": "Performs comprehensive multi-loop deep research"},
    {"agent_type": "researcher", "description": "Performs quick single-turn research"}
  ]
}
```

### Submit a Job

```bash
curl -X POST http://localhost:8000/v1/jobs/async/submit \
  -H "Content-Type: application/json" \
  -d '{"agent_type": "deep_researcher", "input": "Research quantum computing trends in 2026"}'
```

Optional body fields: `job_id` (custom ID), `expiry_seconds` (600–604800), `data_sources` (subset of IDs from `/v1/data_sources`; `[]` disables data-source tools while leaving unmapped utility tools available; unknown IDs return 422).

Response:

```json
{
  "job_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "submitted",
  "agent_type": "deep_researcher"
}
```

### Stream Events (SSE)

```bash
curl http://localhost:8000/v1/jobs/async/job/{job_id}/stream
```

#### Replay and Live Handoff

When a client reconnects to an in-progress job stream, the server replays historical events as fast as possible. The server then sends a `stream.mode` event to indicate that catch-up is complete and the stream has switched to live polling.

Expected handoff event:

```
event: stream.mode
data: {"mode":"live"}
```

The `stream.mode` live event is sent once, after historical replay is complete and before subsequent live events.

### Get Final Report

```bash
curl http://localhost:8000/v1/jobs/async/job/{job_id}/report
```

## SSE Event Types

Events streamed during job execution:

| Event | Description |
|-------|-------------|
| `stream.mode` | Stream state transition event. `{"mode":"live"}` signals replay is complete and live streaming has started |
| `job.status` | Job status changes (running, success, failure) |
| `workflow.start` / `workflow.end` | Workflow lifecycle |
| `llm.start` / `llm.chunk` / `llm.end` | LLM inference progress |
| `tool.start` / `tool.end` | Tool invocations |
| `artifact.update` | Todos, files, citations, output updates |
| `job.error` | Error occurred |

## Configuration

### Default Behavior

| Mode | Async Jobs | Database | Notes |
|------|------------|----------|-------|
| **CLI** (`nat run`) | No | None | Agents run via WebSocket |
| **Web** (`nat serve`) | Yes | `./jobs.db` (or `front_end.db_url`) | Auto-creates SQLite |
| **Production** | Yes | PostgreSQL | Set `NAT_JOB_STORE_DB_URL` or `front_end.db_url` |

### Config File

```yaml
# configs/config_oib_openrouter.yml (abridged)
general:
  front_end:
    _type: agent_host
    runner_class: agent_host.plugin.AgentHostWorker
    db_url: sqlite+aiosqlite:///./jobs.db   # Job store + event store
    expiry_seconds: 86400

functions:
  deep_research_agent:
    _type: deep_research_agent
    orchestrator_llm: nemotron_llm
    tools: [tavily_web_search]
```

### Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `NAT_JOB_STORE_DB_URL` | Job store + event store database | `sqlite+aiosqlite:///./jobs.db` (or via front_end.db_url) |


## Authentication

Authentication is handled by `AuthMiddleware`, which runs on every request.  It
is disabled by default and opt-in via the `REQUIRE_AUTH` environment variable.

### Environment variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `REQUIRE_AUTH` | Enforce authentication on all non-exempt routes | `false` |
| `TRACE_USER_IDENTITY_MODE` | Control whether verified user identity is attached to workflow spans: `none`, `id`, or `full` | `none` |
| `TRACE_USER_IDENTITY_HMAC_SECRET` | Secret used to pseudonymize verified user IDs in traces when identity tagging is enabled | unset |
| `TRACE_CLIENT_ID_MODE` | Control whether a pseudonymous client identifier is attached to workflow spans: `none` or `ip` | `none` |
| `TRACE_CLIENT_ID_HMAC_SECRET` | Secret used to pseudonymize client IDs when client tagging is enabled; falls back to the user-identity secret | unset |
| `TRACE_CLIENT_IP_HEADERS` | Ordered comma-separated client IP headers to trust before falling back to the ASGI client address | `x-real-ip,x-forwarded-for` |

### Enabling authentication

Set `REQUIRE_AUTH=true` and register at least one validator before the server
starts.  The server raises a `RuntimeError` at startup if auth is required but
no validators are registered.

Two registration mechanisms are supported — pick whichever fits your deployment:

### Span request tagging

Auth middleware can enrich exported workflow spans with low-risk request
tags and optional pseudonymous identity tags. The resolved tags are propagated
through HTTP requests, WebSocket workflow execution, and async jobs.

Always-on span tags:

- `nat.app.caller.type`: resolved caller type from the auth middleware
- `nat.app.auth.transport`: `bearer`, `cookie`, or `none`
- `nat.app.auth.verified`: whether the request resolved to a verified principal
- `nat.app.access.channel`: inferred or explicitly supplied access channel

For one release every one of these tags is also written under `aiq.*`, its old
name, so a saved trace view filtering on the old name keeps matching until it
is re-pointed.

Optional user identity tags are controlled by `TRACE_USER_IDENTITY_MODE`:

- `none`: disable user identity tagging entirely
- `id`: tag only pseudonymous stable identifiers (`nat.enduser.id`, `nat.app.user.id`, `nat.app.auth.type`)
- `full`: tag pseudonymous identifiers plus `nat.app.user.email` and `nat.app.user.name` when present

Only verified principals are tagged. Anonymous, internal, and unverified JWT
fallback callers are never attached to traces.
Set `TRACE_USER_IDENTITY_HMAC_SECRET` when using `id` or `full`; otherwise
identity tagging is skipped.

Optional client correlation is controlled by `TRACE_CLIENT_ID_MODE`:

- `none`: disable client correlation
- `ip`: add `nat.app.client.id` as an HMAC-derived pseudonymous identifier from
  the client IP

Set `TRACE_CLIENT_ID_HMAC_SECRET` when using `ip`. If unset, the middleware
falls back to `TRACE_USER_IDENTITY_HMAC_SECRET`. `TRACE_CLIENT_IP_HEADERS`
controls which ingress headers are consulted first.

#### 1. Programmatic (`register_validator`)

Call `register_validator()` in any code that runs before `nat serve`:

```python
from agent_host.plugin import register_validator
from agent_host.auth.jwt_validator import JWTValidator

register_validator(JWTValidator(issuer_url="https://your-identity-provider.com"))
```

#### 2. Entry points (recommended for packages / submodule deployments)

Any installed Python package can contribute validators by declaring an
`agent_host.validators` entry point.  The function must return a list of validator
instances.

```toml
# pyproject.toml of your deployment package
[project.entry-points."agent_host.validators"]
my_provider = "mypackage.auth:get_validators"
```

```python
# mypackage/auth.py
def get_validators() -> list:
    from agent_host.auth.jwt_validator import JWTValidator

    return [JWTValidator(issuer_url="https://your-identity-provider.com")]
```

After `pip install` / `uv sync`, validators are discovered automatically — no
code changes to the server are needed.

### Writing a custom validator

A validator is any object with an async `validate(token: str) -> dict | None`
method.  Return a dict with at minimum `{"type": "<name>"}` on success, or
`None` if the token is not recognized by this validator.  The first validator
to return a non-`None` result wins.

```python
class MyValidator:
    async def validate(self, token: str) -> dict | None:
        payload = verify_token(token)  # your verification logic
        if payload is None:
            return None
        return {"type": "my_provider", "sub": payload["sub"], "token": token}
```

### Caller types and the clarifier

The middleware sets `skip_clarifier=True` for callers that cannot participate in
interactive back-and-forth (anonymous requests, headless API callers).  Pass the
`X-Chat-Mode: headless` request header to force this for any authenticated caller.
For one release the old name, `X-AIQ-Mode`, is read too (and `X-AIQ-Access-Channel`
beside `X-Access-Channel`): the BFF and the backend deploy separately.

---

## Registering New Agents

Agents are registered by type so the job runner can load them from the workflow config. Register at import time (e.g. in your plugin entry point or app startup):

```python
from agent_host.registry import register_agent

register_agent(
    agent_type="my_agent",
    class_path="my_package.agent.MyAgent",
    config_name="my_agent_config",
    description="My custom agent",
)
```

Requirements:
- **config_name** must match a function in your YAML (e.g. `deep_research_agent`).
- The agent class must be constructable from that config and support the run signature expected by the runner (see `jobs/runner.py`).

## Knowledge API

When a `knowledge_retrieval` function is configured in your workflow, the plugin adds:

- **`/v1/collections`** – Create and list collections (uses the same ingestor as the knowledge tool).
- **`/v1/documents`** – Upload files and trigger ingestion.

They serve the llamaindex backend that the `knowledge_retrieval` function sets up (ADR-0072). If no knowledge function is configured, these routes are not registered.

## Comparison with the Runtime's Built-in Async

The runtime's `/generate/async` is not mounted: none of its HTTP turn routes is, since a
chat turn runs on the chat socket alone (`AgentHostConfig`, ADR-0068). The table is
why research jobs never needed it.

| Feature | Runtime `/generate/async` | `/v1/jobs/async` |
|---------|----------------------|------------|
| Job tracking | JobStore | Same JobStore |
| Database | SQLite/Postgres | Same |
| **Agent-agnostic** | No | Yes |
| **SSE streaming** | No | Real-time events |
| **Event replay** | No | Via `last_event_id` |

## Rules of this tier, in full

The full form of the rules in [`AGENTS.md`](AGENTS.md), with their reasons and checks.

The backend image is built here too (ADR-0145 rule 2): `Dockerfile` (context
the repo root, `docker build -f apps/agent-host/Dockerfile .`), `entrypoint.py`,
which starts the role `PROCESS_ROLE` names (ADR-0082), and `start_web.py`, the
uvicorn launcher of the `chat` and `api` roles. The image copies this directory
whole and runs them from `/app/apps/agent-host/`.

### Obligations

| When you | You must | What fails you |
|---|---|---|
| Add a route | Put it in `src/agent_host/routes/` and register it in exactly one role's list in `plugin.py`: `api_routers` / `API_APP_REGISTRARS` for `api`, `CHAT_ROUTERS` for `chat` (ADR-0082). Almost every route is `api`'s; `chat` serves the socket and what KEDA reads from it | `tests/test_roles.py`: a router under `routes/` that no role mounts, or both do, fails it. Without the list, the route exists and nothing serves it |
| Accept a URL this tier will fetch or upload to (a `file_ref`, a presigned archive URL) | Type the field `ObjectStoreUrl` (`agent_host/object_store_url.py`): its origin must be one of the object store's configured endpoints, or the request is a 422 before the handler runs. A URL that arrives another way (a row read back from the ingest queue) goes through `assert_fetchable_object_store_url` before any request | `tests/test_route_url_fields.py` fails a request model or route parameter named `url`, `*_url`, `*_ref`, `*_uri` or `*_href` typed as a plain `str`, unless `NOT_REQUESTED` there says why this tier never requests it. Skipping it is an SSRF hole. [`python-endpoints.md`](../../docs/api/python-endpoints.md#ingestion) |
| Accept a request | Authenticate through `auth/middleware.py`; the validator is resolved from the `agent_host.validators` entry point, not imported | The WorkOS validator is pluggable on purpose (ADR-0002). A direct import hard-wires identity into the API tier |
| Add a job phase | Emit it through `jobs/phase_events.py` so the SSE stream and the event store agree. A research job's own steps (start, prepare, run, persist, finish) are functions in `jobs/agent_job.py`, `agent_job_setup.py` and `job_outcome.py`; a new step is a new function there, not a branch in `run_agent_job` | The UI's progress display and the stored history diverge, and only one of them is replayable |
| Store job payloads | Go through `jobs/payload_crypto.py` | Job payloads carry tenant content into a shared store |
| Remove or rename a `run_agent_job` parameter | Name the old key in `RETIRED_PAYLOAD_KEYS` (`jobs/worker.py`) in the same change, and change its field on `JobRequest` (`jobs/agent_job.py`) with it. Runs waiting on Hatchet, and runs retried after a lost worker, at the upgrade replay the old payload | Every job in flight at the upgrade fails with a TypeError. `tests/test_retired_payload_keys.py` binds replays to the real signature, and `tests/test_agent_job_phases.py` fails a parameter `JobRequest` lacks |
| Change how a research job runs | Keep the one path: `jobs/submit.py` persists the job and starts its `research-run` on Hatchet (`jobs/research_workflow.py`, the only research module that imports `hatchet_sdk`), the `agent-worker` tier runs it through `worker.run_stored_job`, and the cancel route flips `job_info` to INTERRUPTED for the run's `CancellationMonitor` to poll and cancels the Hatchet run by its id (ADR-0021, ADR-0150). The `chat` role submits and the `api` role streams and cancels (ADR-0082) | A second execution path forks cancel, retries and the reaper, and only one of them gets tested. `tests/test_research_workflow.py` fakes Hatchet at `orchestrator_client.reset_for_tests` and asserts what is handed to the SDK |

### Rules that need more than a row

**This tier is stateless about identity and trusting about tenancy.** It
validates the JWT and reads the context headers; it does not look up who you
are. The BFF decided that (ADR-0003, ADR-0007). Anything that needs to *decide*
access belongs in the BFF, not here.

**New background work joins as a Hatchet task** (ADR-0150, runbook
[`docs/deployment/hatchet.md`](../../docs/deployment/hatchet.md)), never as an
in-process pool alone or a claim table of our own. ADR-0150 describes how
`research-run` and `ingest-document` behave (fairness per organization, priority,
retries, the on-failure task). What each task must keep:

- Its input carries ids, the priority and the `payload_crypto` ciphertext, never
  plaintext. Without `JOB_PAYLOAD_KEK` a submit is refused.
- It raises to Hatchet the exception's class and category only, `from None`. The
  message and its chained cause may name a file or a URL, and go to our own logs.
  A transient failure retries (`agent.common.task_failures`); a run that fails on
  its own, or an unreadable payload, raises `NonRetryableException`.
- Hatchet delivers at least once, so a research copy takes the job in
  `jobs/run_ownership.py` before it runs the agent (`submitted` to `running`, or a
  `running` job silent past the ghost reaper's window), and a losing copy runs nothing.
- A cancel with no INTERRUPTED recorded is the execution timeout, and ends as
  FAILURE (`agent_job._finish_cancelled`).
- Only `jobs/ingest_worker.py` serves `ingest-document`; the `chat` and `api` roles
  dispatch and never run a job.

The old `research_job_queue` and `ingest_job_queue` tables and their cutover loops
stay until a later migration drops them ([the cutover](../../docs/deployment/hatchet.md#cutover-from-the-claim-queues)).

**Research waits, it is not refused.** Let a full cluster queue the job:
`MAX_ACTIVE_JOBS_PER_ORG` is the `research-run` concurrency cap per organization,
and the one 429 in `jobs/submit.py` is `MAX_QUEUED_JOBS_PER_ORG`, abuse protection
on how many jobs one organization may have waiting (`submitted` in `job_info`). A
scheduled fire is `bulk`, and a scheduled task that meets the 429 is skipped, not
retried.

**A background run acts as its requester, by echo** (ADR-0108). The worker
injects the identity headers from the run's identity and, when the run carries
one, the requester's signed request-context envelope the BFF minted, so the
tools that act as a person behave as on a chat turn. The envelope is kept at
submit only when it verifies for the run's requester (`jobs/run_envelope.py`,
`capture_request_envelope`), travels in the encrypted payload, and is renewed
by the BFF when the run starts once it is an hour old (`agent_job_setup`, inside
`run_agent_job`). This tier only verifies and forwards what the BFF signed, and
keeps it out of every log. A refusal leaves the run acting as nobody, and those
tools refuse.

## Related Documentation

- [Project ARCHITECTURE](../../docs/architecture/overview.md) – Overall system architecture
