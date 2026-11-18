# Workspace tools: how the agent acts on the office's workspace

The tools in `packages/agent/src/agent/tools/` act on the user's workspace
rather than retrieve from a corpus. Evidence sources are packages under
`packages/`. The rules an agent must follow when it edits this directory are in
[`tools/AGENTS.md`](../../packages/agent/src/agent/tools/AGENTS.md); this page
holds the reasons and the mechanics behind them. Proposals in full, from the
table to the receipt card: [`proposed-changes.md`](proposed-changes.md).

## What lives where

| Directory | Tool | What it is |
|---|---|---|
| `bim/` | `ifc_query`, `ifc_measure` | The BIM surface ([below](#the-bim-surface)) |
| `drawings/` | `dxf_measure` | A project's DXF drawing as a site the agent can measure (ADR-0153) |
| `documents/` | `ls`, `read_file`, `write_file`, `edit_file`, `file_draft` | The conversation's working directory, and its one door into the project |
| `files/` | `propose_file_change` | The write-side workspace verbs, as proposals |
| `look/` | `look` | Bound in every context (ADR-0128): a page, a region of it or an embedded image as an image the model sees. It resolves the document the way the canvas tools do and makes the box glow on the canvas for a workspace document. Every look leaves a `look` Herleitung step at once and, once the answer is final, an item on the document's `look` card if the answer relies on it (`look/cards.py`) |
| `canvas/` | the `document_canvas` group | The review canvas: the room, pointing and highlighting, and Anmerkungen. The agent's own findings are born proposals a person takes over or dismisses. What the person asks for (set a mark, change one, delete one they set) the agent does in their name, under their rights, with a note in the mark's thread. It acts on a document the model names, the one open on the canvas, or the conversation's subject, each checked by the BFF from the envelope. Details: the module docstring of `canvas/register.py` |
| `viewer/` | `show_in_viewer` | Moves the asker's own document viewer (ADR-0144) |
| `tasks/` | `create_task` | Hands work over as a task (ADR-0051) |
| `cross_project/` | `project_lookup` | Reads other projects as the conversation's audience (ADR-0094) |
| `workspace/` | `workspace__*` | The agent as a client of its own MCP server (ADR-0122) |

## The working directory never creates a `documents` row

`write_file` and `edit_file` write into a LangGraph store namespaced by
conversation (`documents/draft_store.py`). Nothing there is a project document:
it is not filed, not indexed, not citable, and it does not appear in the Files
explorer. A draft becomes a document only through the **document lifecycle
API**, which a person gates: the agent may propose, never publish. The Python
tier holds no second path to that API: the BFF is the single writer of `app`
(ADR-0003). The design of record:
[`agent-writes-artifacts-and-approval.md`](../roadmap/agent-writes-artifacts-and-approval.md).

The card the working directory emits (`document_draft`) reports a file. Once
`file_draft` has run it also names the project document, and its two controls,
„Im Projekt öffnen“ and „Zur Freigabe einreichen“, go through the routes the
Files pane already uses, in the reader's own session. A tool here that wrote a
row directly would bypass `requireProjectAccess`, the provenance marking and the
review state in one move.

`file_draft` (`documents/register.py`) is the only tool here that changes the
project. It files a draft and, with `submit=true`, sends that version for review
(it absorbed `submit_draft`). It reaches `POST /api/internal/document-versions`:
one route, ops `create`, `update` and `submit`, closed on the BFF side by the
transition table's `actor` field, so approve, publish, reject and archive have
no machine path at all. This tier decides only which bytes and which reference.
The reference is the conversation's (`{conversationId}-{slug}`), so two turns
writing one document produce two versions rather than two documents.

DeepAgents rebuilds a draft's stored value from `content`/`encoding` on every
write and edit, so a key of ours survives only if `DraftBackend._record`
re-stamps it, as it does `VERSION_KEY` and `FILING_KEYS`. Text the model sends
is NFC-normalised with stored text at the backend seam
(`draft_store.normalize_draft_text`); the symptom without it is in
[`gotchas.md`](../contributing/gotchas.md). A conversation's drafts are swept
only by `DELETE /v1/drafts/{conversation_id}`
(`apps/agent-host/src/agent_host/routes/drafts.py`); drafts left behind outlive
the conversation as bytes under a key that names nothing.

## Echo, never sign

The BFF mints a signed request-context envelope at the start of the turn, from a
real session (`apps/workspace/bff/request-context.ts`). `RequestContext` keeps
the raw header and signature exactly as they arrived, and a tool that acts as a
person forwards those two strings unchanged beside `INTERNAL_API_TOKEN`
(`SignedEnvelope(header, signature).headers()` in `common/bff_http.py`). The BFF
verifies them with the same secret, reads the acting user out of the verified
payload, and builds that person's pinned session. So every permission check,
every `created_by` and every audit actor is the human who asked.

Re-signing a payload here would work, which is the danger: the internal token
and the signing secret are the same secret, so a Python tier that built its own
envelope would be choosing the user id with a credential that only
authenticates the service. A run with no envelope (CLI, eval, a background run
that carries none) has no acting person, and the tool refuses rather than
falling back to the unsigned individual headers (`x-grid-user-id`), which a
caller could have set.

A background run acts as the person who commissioned it (ADR-0108), and the job
worker is then one more echoing party, not a signing one. The job API keeps the
envelope the BFF sent with the submit, only when it verifies for the run's
requester, inside the encrypted job payload. The worker injects those two
strings at claim under the names a chat turn uses, and asks the BFF
(`POST /api/internal/runs/{runId}/envelope`) for a fresh one when the carried
one is older than `RUN_ENVELOPE_RENEW_AFTER_MS` (one hour). A refusal leaves the
run without an envelope; a failure to ask keeps the carried one inside its
six-hour window. The whole path is
`apps/agent-host/src/agent_host/jobs/run_envelope.py`.

## A write-side tool proposes; the server applies it

`propose_file_change` changes the user's workspace four ways (its `operation`
argument is `move`, `rename`, `create_folder` or `assign`), and none of them
changes anything. Each resolves its arguments against what the turn can already
see, stores the proposal as a server object, emits one `file_operation_proposal`
card carrying its id, and returns text whose first words are that nothing has
happened.

A proposal is a server object (ADR-0105). The client is `proposals_client.py`
(`POST /api/internal/proposals`, op `create`, the turn's envelope echoed). The
BFF records the person the agent acted for, and accepting the card asks the
server to apply the proposal in the deciding person's session, through the
services the person's own surfaces use, recording a result per item. The body
is `internalProposalRequestSchema` in `apps/workspace/bff/proposals/types.ts`,
exported as `apps/workspace/tests/fixtures/proposals.schema.json`. Each kind has
exactly one creator, and the card carries the returned `proposal_id`:

| `kind` | Created by | Card | Payload |
|---|---|---|---|
| `file_operation` | `propose_file_change` (`files/register.py`, `files/cards.py`) | `file_operation_proposal` | `operation`, `operations`, `note` |
| `memory` | `remember` (`agent/memory/register.py`), only when an organization-scoped write is refused and the turn is not restricted | `memory_proposal` | `scope`, `kind`, `content`, `confidence`, `supersedes` |
| `project_profile` | `register_envelope_card` (`cards/envelope.py`), called by `_register_envelope_cards` in the chat agent's `envelope_cards.py`, for the model's own `project_profile_patch` card in a turn that is not confined | `project_profile_patch` | `title`, `rationale`, `patch` (the model's `preview` is neither rendered nor recorded) |
| `operation` | The BFF's MCP server, when `workspace__call` runs a write (`apps/workspace/bff/agent-api/operation-proposals.ts`) | `operation_proposal` | the catalog operation and its input |

The profile card is the odd one: the model composes it in the answer envelope
and no tool runs, so the only place a turn can create its proposal is where the
envelope's cards become final. `validate_model_card` strips a `proposal_id` the
model wrote, and `proposal_id` is left out of the shapes the model is taught
(`SERVER_FILLED_CARD_FIELDS`, `cards/proposal_cards.py`): an id on a card is
always one the BFF returned.

The `operation` kind has no creator in this tier. `workspace/cards.py` only
shows it: it reads `structuredContent` `{ decision: 'propose', proposalId,
summary, operation }` off the result and adds an `operation_proposal` card
carrying that `proposal_id` (one card per id: a repeated call gets the same
proposal back). Reads and refusals carry no `decision` and emit no card. The
model reads the server's short text only. A second creator in Python would be a
second path to the same row, the drift ADR-0055 forbids.

Every request names the card: `answerMessageId` and `originCardIndex`, the
card's position in the turn's `CardRegistry`. With the answer's id the index
makes the create idempotent at the database, so a card asked for twice returns
its first proposal. `add_card` therefore puts the card in the registry first and
asks for the proposal second, so the index is the position the card really has
even while a sibling tool adds its own.

When the route is not there (an older BFF answers 404, a run has no envelope,
the BFF is unreachable, the server refuses) no file operation runs from the
browser. The card stays in the registry without `proposal_id` (card positions
are identity: `cardKey` is `type-index` and `originCardIndex` is the idempotency
key of the proposals after it, so it is never taken back out), the UI draws it
read-only with „Konnte nicht als Vorschlag angelegt werden“, and
`propose_file_operation` returns `False`, so the tool tells the model it could
not propose (`_NOT_PROPOSED` in `files/register.py`). A memory note and a
profile patch without an id still go through their own person routes from the
browser. No route is added for the agent that a person could not reach
themselves, so `requireProjectAccess`, the audit trail and the feature gates are
the ones that were already there: ADR-0055 read from this side.

Three consequences for the next operation:

- **Nothing is resolved that the turn cannot see.** A document is matched
  against the turn's inventory rows (`knowledge/inventory.get_turn_documents`),
  and a folder against the paths those rows carry. A name that matches two files
  comes back as a question and never as a proposal naming one of them. A person
  is not resolved here at all: this tier has no member roster, so the card
  carries the name as the user said it and the reader's own session resolves it.
- **A stored proposal does not grow; one call is one proposal.** The internal
  route has `create` and nothing else, so a second move cannot join the first
  one's proposal, and a card that grew on the client would show two moves and
  apply one. „Räum die Einreichunterlagen zusammen“ is therefore four cards.
  Batching server proposals again means creating them once the turn's cards are
  final, at the turn's finish, not per call (`files/cards.py` says why);
  `register_envelope_card` is that place for cards the model composes.
- **An operation with no route behind it does not ship.** `set_doc_class` was a
  fifth verb and is gone: the Dokumentart is settable only on the platform
  corpus, a project document has no such route, and the card drew the proposal
  and no control. A proposal nobody can accept is a worse thing than none, so
  the operation waits for a project-scoped route.

Adding a file operation touches: its branch in `propose_file_change` and its
line in `_DESCRIPTION` (`files/register.py`); `FileOperationKind`
(`cards/file_operation_card.py`); `FILE_OPERATIONS`
(`apps/workspace/bff/proposals/types.ts`); its applier
(`apps/workspace/bff/proposals/executors.ts`). A new write-side tool also needs
its action key in `common/status_keys.py`, its mapping in `common/tool_calls.py`
and its `TOOL_CONTEXT_REQUIREMENTS` row (`project_context.py`). Adding a
proposal kind starts on the BFF (`PROPOSED_CHANGE_KINDS`, its payload in
`internalProposalRequestSchema`, its applier), then `ProposalKind` in
`proposals_client.py`, one creator calling `add_card`, and `proposal_id` on the
card's model. `test_the_contract_has_exactly_the_three_kinds_this_client_can_ask_for`
(`packages/agent/tests/tools/files/test_proposals.py`) fails when the contract
has a kind the client cannot ask for.

## Wire contracts

The proposal and lifecycle bodies are described once, in the BFF's zod, and
exported as JSON Schema fixtures. There is no Pydantic twin. Regenerate a
fixture with `UPDATE_FIXTURES=1` on its spec:

| Contract | Fixture | Spec that writes it | Python tests against it |
|---|---|---|---|
| Proposals | `apps/workspace/tests/fixtures/proposals.schema.json` | `apps/workspace/bff/proposals/proposal-schema.spec.ts` | `packages/agent/tests/tools/files/test_proposals.py`, `packages/agent/tests/memory/test_register.py`, `packages/agent/tests/cards/test_register_envelope_card.py` |
| Document lifecycle | `apps/workspace/tests/fixtures/document-lifecycle.schema.json` | `apps/workspace/bff/documents/lifecycle-schema.spec.ts` | `packages/agent/tests/tools/documents/test_wire_contract.py` |

## The workspace tools are the agent as a client of its own MCP server

`workspace/` (the `workspace_tools` group, ADR-0122) is four tools,
`workspace__search`, `workspace__describe`, `workspace__call` and
`workspace__report_missing`: the meta-tools an external agent gets from
`POST /api/mcp` in `search` mode. Each call is one stateless JSON-RPC
`tools/call` that echoes the turn's envelope beside `INTERNAL_API_TOKEN`. A
write comes back as a proposal the person accepts; this tier applies nothing.
Nothing is added per operation on this side: a new operation is a catalog entry
on the BFF and appears through `workspace__search`.

The runtime's `mcp_client` group does not fit. That client connects once, in a
lifecycle task created at build time, and sends every request from tasks
spawned inside it, which inherit the connect-time contextvars. An auth provider
reading the envelope from a contextvar would send no identity, or another
turn's, on a later turn's call. Here the envelope is read inside the tool, in
the turn's own context, and nothing is connected or cached between calls.
`test_each_call_echoes_the_envelope_of_its_own_turn` and
`test_concurrent_turns_never_swap_identities`
(`packages/agent/tests/tools/workspace/test_workspace_client.py`) pin it.

## Content from another project is recorded by the BFF before it arrives

`project_lookup` (`cross_project/`, ADR-0094) reads other projects, from any
chat, as the conversation's whole audience. It is the one tool here whose
answers come from outside the turn's signed scope, so the usual admission (a
tool reports what it read, the tools node asks the BFF) is not what keeps it
safe. The BFF decides the reach, and records every project and restricted
folder an answer draws on, under the conversation's lock, before it returns the
answer. The tool then notes exactly those collections on the turn
(`note_cross_project_hand_out` in `knowledge/restricted_use.py`), which is what
`admit_tool_results` lets through, and says whether they narrow the chat's
readers (`restricting`: a running project or a restricted folder; a closed
project's open folder does not), which is what shuts the turn's doors. A tool
that admitted foreign content on its own say-so would let the agent decide
access.

`workspace__call` is the second reader: it reads other projects through the
BFF's MCP door, and the BFF holds those reads to the same reach
(`audienceReachAmong`) and records them through the same
`recordCrossProjectHandOut` before the read runs (ADR-0094's amendment,
[`agent-surface.md`](agent-surface.md#reads-in-a-conversation)). A shared chat
reads only a document's content or a project's facts there. The workspace
result carries no `restricting` flag, so a door read of a running project shuts
the turn's doors only where the server judges them (a memory write, a run, a
share is refused against the record), not ahead of time as `project_lookup`
does.

## Canvas writes everyone sees

`mark`, `update`, `delete`, `reply`, `highlight` and a labelled `point` are read
by everyone who opens the document, so each calls `policy.shared_write_refusal()`
first (`canvas/register.py`). A conversation that drew on a restricted folder
would otherwise leak it there. `packages/agent/tests/tools/canvas/test_targets_and_policy.py`
covers the six.

## Where a tool's usage rule goes

A rule about how one of these tools is used goes in that tool's description. The
prompt blocks that once held such rules (`<drafts>`, `<aufraeumen>`,
`<delegieren>`) restated a bound tool's contract in prose charged on every call
of every turn (ADR-0060 (d) and its amendment). A description reaches the model
with the call; a prompt paragraph competes with everything else on the page. The
prompt keeps only an antecedent that lives in the transcript.

## The BIM surface

`bim/` holds two tools over the project's IFC model, not an agent.
`register.py` is `ifc_query`: a structured read of the extracted index,
answering what the export wrote down. `measure_register.py` is `ifc_measure`:
the spatial engine over the model's own bytes, answering what it did not.

**Every number keeps the verb it was got by.** `declared` (the file says so),
`computed` (we measured it, with its tolerance), `inferred` (a heuristic, with
its reasons). `measure_description.py` teaches the model the German sentence for
each. Collapsing them into one figure is how a guess gets stamped as a fact; the
provenance is the audit trail that replaces a quotation.

**`decidable: false` is an answer, not an error.** The question was well formed
and this export cannot answer it. The tool returns what is missing and what the
architect changes in their CAD (`missing.remedy`), kept apart from a call that
could not be made (`failures.py`).

**The vocabulary is also taught to the model.** `VALID_OPERATIONS`, `MEASURES`,
`KINDS`, `RELATIONS` and their siblings are pinned by the
`ifc-spatial-reasoning` skill
(`packages/agent/src/agent/skills/builtin/bim/ifc-spatial-reasoning/SKILL.md`),
which routes between the two tools by operation name. A skill naming a call that
cannot be made costs the reader a whole turn.
`packages/agent/tests/skills/test_ifc_spatial_skill.py` fails an operation or
enum value the skill names on the wrong side of its routing table.

**Field and enum descriptions reach outside agents.** The MCP door serves the
descriptions in `measure_input.py` and `measure_vocab.py` to outside agents with
`ENGLISH_GLOSSES` (`apps/workspace/bff/agent-api/backend-operations.ts`) applied,
phrase by phrase. A German term stays inside a phrase a gloss matches
(`a Wendekreis check`, not a bare `Wendekreis`), and a gloss nothing matches any
more is deleted. After a rewording, regenerate
`apps/workspace/tests/fixtures/backend-tools.schema.json` with
`scripts/generate_backend_tools_schema.py`.
`apps/workspace/bff/agent-api/english-only.spec.ts` fails a German term no gloss
covers; `packages/agent/tests/common/test_backend_tools_schema.py` fails a stale
fixture. Nothing fails a dead gloss.

**The capability-gap ledger (`capability_gaps.py`) records only a name-shaped
value in no vocabulary.** Not `decidable: false` and not a bad GlobalId, and
never in a way that can fail a working measurement. A ledger that logs every
refusal is a log nobody reads.
