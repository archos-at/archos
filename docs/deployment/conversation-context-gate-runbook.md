# Conversation context: the gate before slice 3b

Slice 3b (#1914, ADR-0194) drops the scope paths a run or job submitted before
slice 2 (#1906) still relies on. Deploy it only once nothing from before the
slice-2 deploy is still running.

## Check the gate

Run read-only, against the app database and the job store:

```bash
APP_DATABASE_URL=<app db> NAT_JOB_STORE_DB_URL=<job store db> \
  scripts/conversation_context_gate.py --since <slice-2 deploy time, ISO 8601>
```

It lists every task run still `queued` or `running` that was created before
`--since`, and every async job still `submitted` or `running` that was created
before it. Exit 0 and "gate holds" when both lists are empty; exit 1 with the
lists otherwise. Wait for them to finish, or cancel them, and run it again.

## After the deploy

A run the worker starts without a signed envelope (refused, expired or never
sent) counts in the metric `jobs.envelope_less_runs` (attributes `agent_type`,
`renewal`). It keeps its organization for residency, BYOK and cost, but reads
no project scope. A steady count after the deploy means a caller still submits
without an envelope.
