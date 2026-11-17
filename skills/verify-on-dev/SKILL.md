---
name: verify-on-dev
description: Use when verifying behaviour after a deploy, or debugging an answer or tool call.
---

# Verify on dev

Act through the dev office door, then read what it did in dev's Langfuse: the
platform gateway's Langfuse route reads every trace on dev.

- **Dev runs `develop`** once CI on it is green and the Deploy run after it
  finished. Before that you are testing the previous commit.
- **From a request to its trace** (`listObservations`):
  - an ask (`agent-ask-create`): filter `sessionId` `=` its `conversationId`;
    the turn is the trace `chat-turn`;
  - a door call: `name` `mcp.<operation>`, trace `agent-tool-call`;
  - anything else: `traceName` from the trace-name table in
    [`langfuse.md`](../../docs/observability/langfuse.md), which also lists
    the metadata each trace records.
  Then `traceId` with `fields: ["*"]` reads the whole trace.
- **`fromStartTime` and `toStartTime` are required**, at most 14 days apart,
  even with `traceId`. A trace lands a little after its request: empty right
  away means retry, not "no trace".
- **Prod** reads only the team's own organizations: every call needs the filter
  `{"column": "tags", "operator": "any of", "value": ["org:<id>"]}` with ids from
  `mcpGatewayLangfuseTraceOrgs` in `Pulumi.prod.yaml`, or the gateway refuses it.
- **This explains; it does not gate.** A change to what shapes an answer still
  needs the golden run on dev before and after
  ([which run gates a change](../../docs/contributing/testing-and-verification.md#which-run-gates-a-change)).
