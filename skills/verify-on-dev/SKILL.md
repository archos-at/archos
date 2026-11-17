---
name: verify-on-dev
description: Use when verifying behaviour after a deploy, or debugging an answer or tool call.
---

# Verify on dev

The trace is the truth about what the agent did. Reading the code, a local run
or the answer text is a guess. Never claim agent behaviour works, or say why it
failed, until you have read the trace of a real request on dev.

## The rules

1. **Test the deployed commit.** Dev runs `develop` only after CI on it is
   green and the Deploy run after it finished. Wait for both. A test before
   that is a test of the previous commit and counts for nothing.
2. **Ask like the person.** `agent-ask-create` with the question they would
   type, in their language, with a `projectId`. One new conversation per
   attempt; reuse `conversationId` only when the change is about follow-ups.
3. **Read the whole trace, not the answer.** A right answer from the wrong
   tool calls is a bug that has not shown yet. Look at every tool call, its
   result, the retrieval and the metadata the turn records.
4. **Quote it.** Your summary names the trace id and what the trace shows. A
   claim without one is unverified; say so.

## From a request to its trace

`listObservations`, always with `fromStartTime` and `toStartTime` (at most 14
days apart, required even with `traceId`):

- an ask: filter `sessionId` `=` its `conversationId`; the turn is `chat-turn`;
- a door call: `name` `mcp.<operation>` (trace `agent-tool-call`);
- anything else: `traceName` from the trace-name table in
  [`langfuse.md`](../../docs/observability/langfuse.md), which also lists what
  each trace records.

Then `traceId` with `fields: ["*"]`. A trace lands shortly after its request:
empty at once means retry, never "no trace".

## Prod

Only the team's own organizations are readable. Every call carries
`{"column": "tags", "operator": "any of", "value": ["org:<id>"]}` with ids from
`mcpGatewayLangfuseTraceOrgs` in `Pulumi.prod.yaml`; the gateway refuses any
other. Debug on dev; read prod only for what dev cannot reproduce.

## Not the gate

This tells you why. A change to what shapes an answer still needs the golden run
on dev before and after
([which run gates a change](../../docs/contributing/testing-and-verification.md#which-run-gates-a-change)).
