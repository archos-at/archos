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
  document refuses every OpenRouter request in its scope (`licensed_document_scope`, alias
  `licensed_ingest`; `refuse_unattested_model_read` in `openrouter._pinned_request`), so it is never
  transcribed, embedded or summarised. `look` refuses such a page, and so does the agent host's
  revision comparison (`routes/revision_compare.py`, 403).
- **Work on one licensed document runs in its scope.** An ingest, a `look` at a page and a revision
  comparison run inside `licensed_document_scope(terms)`: every model call in it goes to
  zero-retention endpoints whatever the organization's setting (the OpenRouter transports pin it, and
  the chat contract merges the pin into the request), a non-OpenRouter (BYOK) endpoint is refused,
  and the generations are traced as metadata (length, sha256), still recorded with model, usage and
  cost. `look` sends a licensed page's text, never its image, and returns its reading as a licensed
  hit, so the reading too is a reference in the transcript. `look` reads the licence off the document whatever its shelf, and fails
  closed where a copy may hide: an office shelf file with no point at all (the office layer indexes no
  unconfirmed or unattested copy) or a workspace document with no collection is read as licensed and
  unattested. On a turn that may expand no licensed text it makes no vision call at all.
- **A reference, not the text.** `render_grounding_block` renders a licensed hit with a `Licence:`
  line and a reference token in its fence, `⟦licensed:lp_<16 hex of the passage's sha256>.<anchor>⟧`.
  The anchor is base64url JSON of the hit's collection, file, page and body length: metadata the
  header states anyway. The text is filed in the turn's `LicensedCapture`, opened with the grounding
  capture and dropped with it, never serialised. The same passage gets the same reference, on every
  call and every turn, so the provider's prompt-cache prefix stays stable.
- **Expanded inside the call, whole, and only to zero retention.** The chat-request contract
  (`llm_factory`) replaces references with their text after LangChain has reported the messages to
  every callback, so Langfuse and the agent runtime's spans log the token. The model reads each
  passage whole, as its tool returned it (a section, pages, a clause, as the question needs); nothing
  caps what it reads. The text goes only to a request pinned to zero-retention endpoints (ADR-0074):
  an organization that switched retention limits off, or a BYOK endpoint, gets a note instead.
- **A later turn reads the passage again from its document.** Licensed text is not carried between
  turns; the reference is. At the start of a chat turn (`licensed_recall.open_grounding_capture`),
  each anchored reference in the history's tool results that the new capture lacks is read again
  (`knowledge_layer.estate.licensed_passage_sources`: the page's points and its page text) and filed
  only when a candidate's sha256 matches the reference, its collection is in the turn's signed scope,
  the copy is still licensed and attested, and the flag is on. A changed, withdrawn or deleted copy,
  a reference with no anchor (a `grep` line, a judge's excerpt) and one typed into a message expand
  to `EXPIRED_NOTE`. So a reference never expires while its copy exists and is attested.
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
  own tokens. One reply carries at most `ANSWER_QUOTE_FACTOR` (3) times the smallest cap of what it
  read, all quotes and channels together; past that budget every further run is cut.
- **Direct traces** (`observability.direct_trace._clip`) cap every payload against the turn's
  licensed text, and an ingest of a licensed document (`ingest.measures.file_trace`, keyed on the
  job config's `licence_class`) records its generations as metadata only: length and sha256.
- **The registry and the estate.** A licensed hit's `chunk_text` in the citation registry is cut to
  its quote cap. The whole passage stays in memory for the turn (`SourceRegistry.licensed_text`,
  cleared when the next turn binds the registry, never serialised), so the quote check verifies a
  quotation from anywhere in it. `grep`'s index of lines puts a licensed document's lines behind a
  reference, expanded only inside the call.
- **The search's own judges read references.** The reranker and the requery judge
  (`search/rerank._build_user_prompt`, which `requery` shares) render a licensed excerpt through
  `licensed_body`, so the excerpt reaches the judge model only as an expanded reference, on a
  zero-retention request, and an unattested one not at all.
- **Everything else that could carry licensed text out.**
  - A web search whose query shares a shingle with the turn's licensed text is refused before the
    provider sees it (`licensed_text.refused_outbound_query`, in `tavily_web_search`).
  - A turn that read licensed text is tagged `licensed-text` on its root observation (through the
    turn-outcome box, `turn_outcome.record_turn_tag`, which a tool's copied context still reaches),
    and the `chat-turn-judges` rule skips
    it (`none of`): its trace holds references, so a judge would grade the answer against the wrong
    evidence. It carries the score `licensed-quote-capped` (quotes a reply had cut; 0 when it kept
    to the cap).
  - The lessons distiller takes no vote on an answer whose turn read licensed text (design E44). The
    seam tags such a turn on its turn-outcome box; the socket reads the tag where it persists the
    answer and writes `licensed_text` into the server's answer row (`chat_socket.persist_turn_result`),
    stored as `licensedText` (`agent-answer-metadata.ts`). When the asking tab stored the answer first
    (inserts no-op on conflict), the mark is merged into the tab's row
    (`persistInternalConversationMessages`). The browser never writes it, so a closed tab or a stopped
    turn keeps it, and `platform-lessons/licensed-text.ts` excludes such an answer. With the flag off
    nothing is read, so nothing is marked and the distiller's input is what it was. Deep research reads
    no licensed text (see below), so its job-written answers need no mark. A lesson reaches every office.
  - The `Licence:` line asks for the answer's label ("Norm, Büroexemplar Ausgabe 2017, zuletzt
    geprüft am …"), read from the office base knowledge block by the hit's `knowledge_edition_id`,
    and for every quote in the language the passage is written in: a translation is no quote and
    no source.
  - The agent door's tools (`apps/agent-host`) run without a turn capture, so a licensed hit reaches
    an outside agent listed only. The door's document routes are held in the BFF by the sibling
    change on the office layer (`base-knowledge/door-guard.ts`): a licensed copy's file and links
    are never sent to an agent, and its text is refused while unattested, otherwise cut to three
    quote caps per document, person and day, cumulatively (design E19).
  - Cross-project search snippets (`tools/cross_project`, up to 900 characters each) carry no licence
    mark yet: the BFF's hit does not state one. A licensed copy filed in a project would reach the
    agent as a snippet. Follow-up: the BFF states the mark on the hit (`licenceOfDocument`).
  - Derived text is stored as written. A document summary or a folder dossier a model wrote while
    reading a licensed copy (in its licensed scope, so at zero retention) is model output stored in
    the database; it is not the licensed text, and this seam does not cap a paraphrase or a quote
    inside it. A revision comparison of an attested copy's pages (`routes/revision_compare.py`) is
    derived text of the same kind: its reply, the model's account of what changed between the two
    pages, is kept in the shared cache (Dragonfly, `_remember`, 30 days) as written.
- **The flag.** `licensed-seam` (entitlement, read per turn through `GET /api/internal/stages`)
  decides whether the turn's capture may expand at all. Off, a licensed hit is listed (document,
  page, clause) with no text, nothing is recalled, and the web search's description and the
  distiller's input are unchanged. The seam itself is never off: a marked passage is never rendered
  as text. No text a model reads names this record.

### Consequences

- Good: the checkpoint, the history, the traces, the citation cache and the logs hold a token, and
  the guarantee needs no exporter to recognise licensed text.
- Good: the answer can still read a licensed table; the eval (`task be:eval:licensed`) measures how
  well against the unmarked ceiling and the listed-only floor.
- Bad: a later turn pays one store read per earlier reference to read it again, and a reference
  with no anchor (a `grep` line) is lost; the turn has to search again for it.
- Bad: a passage that a turn read but that its document no longer holds byte-for-byte (a
  re-ingest that changed chunking) cannot be recalled; the hash check prefers losing it to
  expanding other text.
- Neutral: deep research and intake open the grounding capture without the flag, so they list
  licensed passages and read none, until a caller passes the flag on.

### Confirmation

`packages/agent/tests/common/test_licensed_seam.py` plants a passage with a unique shingle and runs a
real `ChatOpenAI` against a mock wire: the wire must read it; no callback, the checkpointed messages
or the log may hold more than the cap; the reply's content and tool-call arguments are capped and
still parse; each assertion has an unmarked positive control. The ordering test holds that the
callback saw the reference and the request the text.
`packages/knowledge-layer/tests/test_licensed_hits.py` holds the producers and the recall's sources;
`packages/agent/tests/common/test_licensed_recall.py` holds the recall (the hash, the scope, the
attestation, the flag, a reference typed into a message). The `look` and revision-comparison tests
hold that a licensed page sends no image and an unattested one is refused.

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
