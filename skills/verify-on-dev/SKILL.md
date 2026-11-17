---
name: verify-on-dev
description: Test a change on dev and read the agent's Langfuse traces for it. Use when verifying behaviour after a deploy, or debugging an answer or tool call.
---

# Verify on dev: act, then read the trace

Dev (`app.dev.archos.tech`) runs `develop` after every green CI run (`deploy.yml`).
Two MCP servers you can hold yourself let you test there end to end:

| Server | URL | What it is for |
|---|---|---|
| Office door, dev | `https://app.dev.archos.tech/api/mcp` | Act as the signed-in person: `agent-ask-create`, `project-list`, any workspace operation |
| Langfuse, dev | `https://platform-mcp.dev.archos.tech/langfuse/mcp` | Read what that produced: `listObservations` over every trace on dev |

In a claude.ai session these are usually connected already, as `ARCHOS_DEV` and
`DEV_LANGFUSE`. Elsewhere, add them as HTTP MCP servers and sign in with WorkOS
in the platform organization. If Langfuse lists no `listObservations`, the
gateway on that stack reads no traces (`mcpGatewayLangfuseTraceOrgs`,
[`platform-mcp-gateway.md`](../../docs/deployment/platform-mcp-gateway.md)).

## The loop

1. **Confirm dev runs your commit.** CI on `develop` must be green and the
   Deploy run after it finished. Testing an older image proves nothing.
2. **Act.** Make the request the change is about, through the door. For agent
   behaviour that is `agent-ask-create` with the question a person would type
   and a `projectId` from `project-list`. Note the `conversationId` it returns
   and the time.
3. **Find the trace.** `listObservations` needs `fromStartTime` and `toStartTime`
   (at most 14 days apart). Narrow by:
   - a turn: filter `{"column": "sessionId", "operator": "=", "value": "<conversationId>"}`;
     the turn's trace is `chat-turn`, its session the conversation;
   - a door call: `name` `mcp.<operation>` (trace `agent-tool-call`);
   - anything else: `traceName` from the trace-name table in
     [`langfuse.md`](../../docs/observability/langfuse.md).
   Then page one trace with `traceId` and `fields: ["*"]` for inputs, outputs
   and metadata. Export to Langfuse is asynchronous: an empty result right
   after the request means retry shortly, not "no trace".
4. **Judge.** Read what the model saw and did: the tools it called and their
   results, the retrieval, the metadata the turn records (the field tables in
   `langfuse.md`), errors and levels, the scores the checks wrote. Compare
   against what the change should have made true.
5. **Change and repeat.** Fix, push, wait for the deploy, and ask again in a
   new conversation (or follow up with `conversationId` when the change is
   about follow-ups).

## Production

The prod door works the same way, but the Langfuse route there reads only the
platform team's own organizations, and every `listObservations` call must pin
them: a filter `{"column": "tags", "operator": "any of", "value": ["org:<id>"]}`
with ids from `mcpGatewayLangfuseTraceOrgs` in `Pulumi.prod.yaml`. Without the
pin the gateway refuses the call. A customer's office is never readable here.

## What this loop is not

A change to what shapes an answer is gated by the golden run on dev, before
and after ([which run gates a change](../../docs/contributing/testing-and-verification.md#which-run-gates-a-change)).
This loop is how you find out why; the golden run is how you show the change is
not worse. Asks spend the office's model budget: ask what the change needs.
