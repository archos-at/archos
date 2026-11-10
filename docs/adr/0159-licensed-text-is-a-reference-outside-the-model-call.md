---
status: proposed
date: 2026-11-06
decision-makers: engineering
consulted: the country base knowledge design (v7, sections 4.7 and 6.4) and its review
informed: everyone who renders retrieved passages, traces a model call or ingests an office's documents
---

# Licensed text is a reference everywhere but inside the model call, and leaves it only as capped quotes

## Context and Problem Statement

An office may hold text it licensed rather than owns: its copy of an ÖNORM or a DIN, a paid
commentary. The office carries the licence risk, and we promised feld72 "zero retention for
norms": no licensed body may rest in a trace, a log, a cache, a checkpoint, a job payload, an
analytics event or an export. Until now zero retention existed only per organization, as provider
routing (ADR-0074). Inside our own process every retrieved passage was text: in the `ToolMessage`
that the checkpointer stores and the next turn re-sends, in the agent runtime's span of the tool
call and the model call (exported to Langfuse), in the citation registry (cached and persisted with
the answer), in `grep`'s index of lines around a match, and in every direct generation an ingest
records (`vision_calls._observed_vlm_call` writes each page's transcription).

The question this record answers: where licensed text may exist in this process, and how much of
it may leave in an answer.

## Decision Drivers

- **One seam, not a checklist of consumers.** The review found a seam around the chat call alone
  would still leave vision calls, research, exports, traces and PostHog holding licensed text.
- **Observable stays observable.** Every model call remains a Langfuse generation (ADR-0089): its
  content is redacted, the generation is not dropped.
- **Fail closed.** A mark the seam does not understand, a turn that opened no capture, a flag that
  cannot be read: each means less text, never more.
- **Unchanged for everything unmarked.** A turn that touches no licensed passage sends and records
  exactly the bytes it did before.

## Considered Options

1. **References in the transcript, expansion inside the call, a shingle cap on the reply.**
2. **Short quotes only:** the model gets at most `quote_max_chars` of a licensed passage and never
   the whole of it.
3. **Redact at the exporters:** keep text in the transcript and strip it in the Langfuse exporter,
   the logger and the cache.

## Decision Outcome

Chosen option 1, because it is the only one that keeps the text out of every store by construction
while the model still reads what the office licensed for this use.

- **The mark.** A search-index point, or a document row, carries `licence_class`
  (`public_open`, `public_restricted`, `licensed`) and `quote_max_chars`; the office layer writes
  both at upload. `licensed_text.licence_from_metadata` reads them, and an unknown class is read as
  `licensed`.
- **Attested for AI processing, or usable by no model.** An office licence for office-wide use does
  not by itself allow processing by hosted AI services (design 4.7). The office attests that
  separately, and the point or the ingest job carries it as `ai_processing_attested: true`; anything
  else, a missing field included, is not attested. A licensed passage without it renders as listed
  only (document, page, clause, no text, `UNATTESTED_NOTE`) whatever the flag says, nothing of it is
  quotable (`licensed_text.quotable` gives the citation registry nothing), and the ingest of such a
  document refuses every OpenRouter request in its scope (`licensed_ingest`,
  `refuse_unattested_model_read` in `openrouter._pinned_request`), so it is never transcribed,
  embedded or summarised.
- **A reference, not the text.** `render_grounding_block` renders a licensed hit with a `Licence:`
  line and a reference token `⟦licensed:lp_…⟧` in its fence; the text is filed in the turn's
  `LicensedCapture`, opened with the grounding capture and dropped with it, never serialised.
- **Expanded inside the call, whole, and only to zero retention.** The chat-request contract
  (`llm_factory`) replaces references with their text after LangChain has reported the messages to
  every callback, so Langfuse and the agent runtime's spans log the token. The model reads each
  passage whole, as its tool returned it (a section, pages, a clause, as the question needs); nothing
  caps what it reads. The text goes only to a request pinned to zero-retention endpoints (ADR-0074):
  an organization that switched retention limits off, or a BYOK endpoint, gets a note instead. A
  reference from an earlier turn expands to a note that says so: licensed text is not carried
  between turns.
- **The provider's prompt cache keeps working.** "No licensed text in caches" means our persistent
  stores (Dragonfly, LangGraph checkpoints, job payloads, Langfuse, logs), not the provider's
  short-lived in-memory prompt cache, which the zero-retention endpoints' terms cover. Expansion is
  deterministic, so every call of a turn sends the same bytes: the OpenAI family caches that prefix
  automatically, and for Claude the existing top-level `cache_control` (`prompt_caching`) moves its
  breakpoint to the end of each request, which lies after every expanded norm. The later calls of an
  agent loop read the norm from the cache. `task be:eval:licensed -- --calls 3` measures cache reads,
  cost and the later calls' seconds, and `--no-cache-marker` is the arm without the breakpoint.
- **Capped on the way out, the quotes only.** A call that expanded anything returns through `QuoteCap`, a matcher on
  24-character shingles that lets a run of licensed text through up to the passage's
  `quote_max_chars` and drops the rest, writing `[…]`, in the content, reasoning and tool-call
  arguments (escape-aware for JSON), before any callback sees a token. A capped stream reports its
  own tokens.
- **Direct traces** (`observability.direct_trace._clip`) cap every payload against the turn's
  licensed text, and an ingest of a licensed document (`ingest.measures.file_trace`, keyed on the
  job config's `licence_class`) records its generations as metadata only: length and sha256.
- **The registry and the estate.** A licensed hit's `chunk_text` in the citation registry is cut to
  its quote cap; `grep`'s index of lines prints none of a licensed document.
- **The flag.** `licensed-seam` (entitlement, read per turn through `GET /api/internal/stages`)
  decides whether the turn's capture may expand at all. Off, a licensed hit is listed (document,
  page, clause) with no text. The seam itself is never off: a marked passage is never rendered as
  text.

### Consequences

- Good: the checkpoint, the history, the traces, the citation cache and the logs hold a token, and
  the guarantee needs no exporter to recognise licensed text.
- Good: the answer can still read a licensed table; the eval (`task be:eval:licensed`) measures how
  well against the unmarked ceiling and the listed-only floor.
- Bad: a later turn does not see the earlier turn's licensed passages and has to search again; its
  prompt-cache prefix changes at that point of the history.
- Bad: a quote from a licensed passage beyond its first `quote_max_chars` cannot be verified
  against the registry, which holds only that much; the quote check may flag it.
- Neutral: deep research and intake open the grounding capture without the flag, so they list
  licensed passages and read none, until a caller passes the flag on.

### Confirmation

`packages/agent/tests/common/test_licensed_seam.py` plants a passage with a unique shingle and runs a
real `ChatOpenAI` against a mock wire: the wire must read it; no callback, the checkpointed messages
or the log may hold more than the cap; the reply's content and tool-call arguments are capped and
still parse; each assertion has an unmarked positive control. The ordering test holds that the
callback saw the reference and the request the text.
`packages/knowledge-layer/tests/test_licensed_hits.py` holds the producers.

## Pros and Cons of the Options

### References with expansion inside the call

- Good, because no store outside the provider request ever holds the body.
- Bad, because it needs a per-turn capture and a reply matcher.

### Short quotes only

- Good, because nothing needs expanding or capping: the model cannot repeat what it never saw.
- Bad, because a value outside the quote window cannot be answered; an office's own copy of a norm
  becomes a citation it cannot read from.

### Redact at the exporters

- Good, because the transcript is untouched.
- Bad, because every exporter must recognise licensed text, the checkpoint and the citation cache
  still hold it, and a new consumer leaks until somebody adds a filter.

## More Information

Design: `docs/design/international/design.md` on the `claude/intl-design` branch, sections 4.7 and
6.4. The office layer that writes the mark is a sibling change (ticket 32).
