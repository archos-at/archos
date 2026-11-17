---
name: verify-on-dev
description: Use when verifying behaviour after a deploy, or debugging an answer or tool call.
---

# Verify on dev

Treat the agent as a system you observe, not one you reason about. What it does
depends on the prompt, the model, the retrieval, the tools and the data, all at
once, and no reading of the code tells you how they combine on a given
question. The deployed agent does, and its Langfuse trace records it. So work
empirically: make it act, read what it did, and let that, not your expectation,
decide what is true.

## The loop

**Act on dev, as a person would.** Dev runs `develop` once CI on it is green
and the Deploy run after it has finished; anything earlier exercises the old
commit. Ask through `agent-ask-create` the way an architect in that office would
ask: their words, their language, in a project. A tidy test question finds the
tidy path, and the bugs live on the other ones. Start a new conversation for each
attempt, so that the earlier ones do not steer it.

**Read the trace, not the answer.** The answer is the last line of a long
story. The trace holds the rest of it: which tools ran, what they returned,
what retrieval found and what it missed, what the turn recorded about itself.
A right answer reached the wrong way is a bug that has not surfaced yet. Read
until you can say why the agent did what it did.

**Change from evidence.** Form the hypothesis from what the trace shows, change
one thing, wait for the deploy, and ask again. The next trace confirms or
refutes it. What you report is what a trace showed, by its id. Anything else is
still a guess, so call it one.

## Finding the trace

`listObservations` takes `fromStartTime` and `toStartTime`, at most 14 days
apart, even with a `traceId`.

- An ask: filter `sessionId` `=` the `conversationId` it returned; the turn is
  `chat-turn`.
- A door call: `name` `mcp.<operation>`, in trace `agent-tool-call`.
- Anything else: `traceName`, from the trace-name table in
  [`langfuse.md`](../../docs/observability/langfuse.md), which also says what
  each trace records.

Then read it whole with `traceId` and `fields: ["*"]`. A trace lands shortly
after its request, so an empty result right away means try again.

Prod's Langfuse reads only the team's own organizations, and each call carries
`{"column": "tags", "operator": "any of", "value": ["org:<id>"]}` with ids from
`mcpGatewayLangfuseTraceOrgs` in `Pulumi.prod.yaml`. Debug on dev, and go to
prod only for what dev cannot reproduce.

## What it does not replace

This loop tells you why. Whether a change to what shapes an answer made answers
better or worse is the golden run's question, on dev before and after
([which run gates a change](../../docs/contributing/testing-and-verification.md#which-run-gates-a-change)).
