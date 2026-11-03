# The API plugin: `apps/agent-host`

The backend's FastAPI front end, loaded by the agent runtime as a front-end plugin
(`_type: agent_host`): REST routes, the async job API with SSE streaming, and
`/v1/ingest`. A uv workspace member, installed into the same venv as the agent.

The backend image is built here too (ADR-0145 rule 2): `Dockerfile` (context
the repo root, `docker build -f apps/agent-host/Dockerfile .`), `entrypoint.py`,
which starts the role `PROCESS_ROLE` names (ADR-0082), and `start_web.py`, the
uvicorn launcher of the `chat` and `api` roles. The image copies this directory
whole and runs them from `/app/apps/agent-host/`.

## Obligations

| When you | You must | What fails you |
|---|---|---|
| Add a route | Put it in `src/agent_host/routes/` and register it in exactly one role's list in `plugin.py`: `api_routers` / `API_APP_REGISTRARS` for `api`, `CHAT_ROUTERS` for `chat` (ADR-0082). Almost every route is `api`'s; `chat` serves the socket and what KEDA reads from it | `tests/test_roles.py`: a router under `routes/` that no role mounts, or both do, fails it. Without the list, the route exists and nothing serves it |
| Accept a request | Authenticate through `auth/middleware.py`; the validator is resolved from the `agent_host.validators` entry point, not imported | The WorkOS validator is pluggable on purpose (ADR-0002). A direct import hard-wires identity into the API tier |
| Add a job phase | Emit it through `jobs/phase_events.py` so the SSE stream and the event store agree. A research job's own steps (start, prepare, run, persist, finish) are functions in `jobs/agent_job.py`, `agent_job_setup.py` and `job_outcome.py`; a new step is a new function there, not a branch in `run_agent_job` | The UI's progress display and the stored history diverge, and only one of them is replayable |
| Store job payloads | Go through `jobs/payload_crypto.py` | Job payloads carry tenant content into a shared store |
| Remove or rename a `run_agent_job` parameter | Name the old key in `RETIRED_PAYLOAD_KEYS` (`jobs/worker.py`) in the same change, and change its field on `JobRequest` (`jobs/agent_job.py`) with it. Runs waiting on Hatchet, and runs retried after a lost worker, at the upgrade replay the old payload | Every job in flight at the upgrade fails with a TypeError. `tests/test_retired_payload_keys.py` binds replays to the real signature, and `tests/test_agent_job_phases.py` fails a parameter `JobRequest` lacks |
| Change how a research job runs | Keep the one path: `jobs/submit.py` persists the job and starts its `research-run` on Hatchet (`jobs/research_hatchet.py`, the only research module that imports `hatchet_sdk`), the `agent-worker` tier runs it through `worker.run_stored_job`, and the cancel route flips `job_info` to INTERRUPTED for the run's `CancellationMonitor` to poll and cancels the Hatchet run by its id (ADR-0021, ADR-0150). The `chat` role submits and the `api` role streams and cancels (ADR-0082) | A second execution path forks cancel, retries and the reaper, and only one of them gets tested. `tests/test_research_hatchet.py` fakes Hatchet at `hatchet_client.reset_for_tests` and asserts what is handed to the SDK |

## Rules that need more than a row

**This tier is stateless about identity and trusting about tenancy.** It
validates the JWT and reads the context headers; it does not look up who you
are. The BFF decided that (ADR-0003, ADR-0007). Anything that needs to *decide*
access belongs in the BFF, not here.

**Background work runs on Hatchet** (ADR-0150, runbook
[`docs/deployment/hatchet.md`](../../docs/deployment/hatchet.md)): a research run
is a `research-run`, a document an `ingest-document`, each fair across offices
by its organization key. A research
job is a `research-run` task (ADR-0150): concurrency `GROUP_ROUND_ROBIN` on
`input.organization_id` capped at `MAX_ACTIVE_JOBS_PER_ORG`, `interactive` at
`Priority.HIGH` before `bulk` at `Priority.LOW`, retries only after a lost worker
(a run that fails on its own, and an unreadable payload, raise
`NonRetryableException`), and an on-failure task that writes FAILURE unless a
verdict stands. Hatchet delivers at least once, so a copy takes the job in
`jobs/run_ownership.py` before it runs the agent (`submitted` to `running`, or a
`running` job silent past the ghost reaper's window) and a losing copy runs
nothing; a cancel with no INTERRUPTED recorded is the execution timeout and ends
as FAILURE (`agent_job._finish_cancelled`). Its input carries ids, the priority and the `payload_crypto`
ciphertext, never plaintext; without `JOB_PAYLOAD_KEK` a submit is refused. The
run's id is kept in `research_orchestrator_runs` (`jobs/orchestrator_runs.py`)
for the cancel. Ingestion follows the same shape: the `ingest-worker` tier runs
`ingest-document` runs, and the `chat` and `api` roles only start them. The claim
queues they replaced, `research_job_queue` and `ingest_job_queue`
(`agent.knowledge.ingest_queue`, `jobs/ingest_dispatch.py`,
`jobs/ingest_worker.py`'s claim loop, ADR-0076), are kept until the cutover
drains them, and a later migration drops the tables;
`python -m agent_host.jobs.requeue_legacy` starts what the research table still
held at the cutover. Do not add a caller to either queue.

**Research waits, it is not refused.** Capacity never makes `jobs/submit.py`
raise: `MAX_ACTIVE_JOBS_PER_ORG` is the `research-run` concurrency cap per
organization, and the one 429 left is `MAX_QUEUED_JOBS_PER_ORG`, abuse protection on how
many jobs one organization may have waiting (`submitted` in `job_info`). A scheduled fire is `bulk`. Do not
turn a full cluster back into a refusal: a scheduled task that meets one is
skipped, not retried.

**A background run acts as its requester, by echo** (ADR-0108). The worker
injects the identity headers from the run's identity and, when the run carries
one, the requester's signed request-context envelope the BFF minted, so the
tools that act as a person behave as on a chat turn. The envelope is kept at
submit only when it verifies for the run's requester (`jobs/run_envelope.py`,
`capture_request_envelope`), travels in the encrypted payload, and is renewed
by the BFF when the run starts once it is an hour old (`agent_job_setup`, inside
`run_agent_job`, so a run that waited on Hatchet starts with a fresh one). This tier verifies and forwards; it
never builds or signs one, and never logs one. Any refusal or failure means the
run acts as nobody and those tools refuse.

## Reference

- [`README.md`](README.md) here has the run commands and the layered
  architecture diagram.
- Endpoint contracts: [`docs/api/python-endpoints.md`](../../docs/api/python-endpoints.md).
- ADR-0150 (Hatchet), ADR-0021 (db-claimed workers, superseded in part), ADR-0018 (per-run state), ADR-0028 (conversation affinity).
