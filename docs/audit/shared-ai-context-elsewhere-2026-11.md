# Personal and shared context in other AI products, November 2026

How eight products decide what an assistant may use when several people work
with it, read on 2026-11-24 for
[ADR-0193](../adr/0193-a-person-s-own-shelf-is-drawn-on-only-where-its-owner-alone-reads.md).
Our own code is surveyed in [`chat-scope-and-sharing-2026-11.md`](chat-scope-and-sharing-2026-11.md).

## How far to trust it

One research agent read the vendors' help pages; most carry no absolute date.
**Rows marked „read“ were fetched again and quoted by the author of this page.**
The others are the agent's reading of the linked page. Products change these
rules often; re-read the page before citing a row.

## What each product does

| Product | Whose access an answer uses | Personal memory in a shared space | An answer from restricted sources, once others read it | |
|---|---|---|---|---|
| ChatGPT, [shared projects](https://help.openai.com/en/articles/10169521-projects-in-chatgpt) | The project's chats, files and instructions | Never: shared projects „cannot access an individual member's memories or context from outside the project“ | Not addressed | read |
| ChatGPT, [group chats](https://help.openai.com/en/articles/12703475-group-chats) | — | At launch, not used and not written ([announcement, 2025-11-13](https://openai.com/index/group-chats-in-chatgpt/)) | — Group chats are being retired: none can be created or joined since 2026-07-09 | read |
| Claude, [projects](https://support.claude.com/en/articles/9519177-how-can-i-use-projects) | The project's knowledge and memory | Yes by default: „the project's memory alongside your memory from chats outside of projects“; a project can turn off „Use account memory“ | Not addressed | read |
| Microsoft 365 Copilot, [Teams group chats](https://support.microsoft.com/en-us/office/how-to-use-microsoft-365-copilot-in-teams-group-chats-2c613de4-cd26-4ae3-9e4b-6905d745d991) (public preview) | The asker's: „grounded in the data of the person who asks“ | Not stated | **Per answer:** if it used sources not every member may read, only the asker sees a preview, with Approve or Reject; on Reject the others see that it „could not be shared“ | read |
| Microsoft 365 Copilot, [overview](https://learn.microsoft.com/en-us/copilot/plan/copilot-overview); [Pages and Notebooks](https://learn.microsoft.com/microsoft-365/loop/cpcn-permission) | The asker's permissions in Microsoft Graph | — | Sharing a Copilot Notebook grants access to its linked files „where possible“; sharing a Page grants access to that page only | read |
| Gemini in Workspace, [help](https://support.google.com/a/users/answer/17010577) | „The same access to Workspace data as you do“ | Not stated | Not addressed | |
| Notion AI, [connectors](https://www.notion.com/en-gb/help/notion-ai-connectors) | Acts as the user; nothing they cannot open | Not stated | Not addressed; answers cite their sources | |
| Slack AI, [search](https://slack.com/help/articles/31739993134867-Search-with-Slack-AI) | Only what the user may see: public channels, their private channels and DMs | — | Not addressed; answers cite the messages used | |
| Glean, [permissions](https://developers.glean.com/libraries/indexing-sdk/permissions) | Enforced at query time; „never index sensitive content with an allow-all ACL“; test by searching as a restricted user | — | — | |
| GitHub Copilot Spaces, [teams](https://docs.github.com/en/copilot/how-tos/context/copilot-spaces/collaborating-with-your-team-using-copilot-spaces) | Roles admin, editor, viewer; a viewer sees only sources they may read | — | Not stated | |

## What it tells us

- **Everyone scopes to the asker's own access.** No product documents a rule of
  „only what every reader may read“ for a whole conversation. Ours is stricter,
  and the risk the others leave open is the one ADR-0193 closes: an answer drawn
  from one person's sources, read by people who may not open them.
- **Personal memory stays out of shared spaces**, explicitly at ChatGPT. Claude
  is the exception and lets a project opt out. Our rule matches ChatGPT.
- **Only Microsoft re-checks an answer before others see it**, per answer, with
  the asker approving. It keeps a shared chat useful where ours would stop
  drawing on the restricted source altogether.
- **Citations are how users learn what was read** (Slack, Notion). None shows
  whose memory shaped an answer.
- **No product says what happens to answers already written** when a reader
  loses access later.

## Where the decision sits: published patterns

| Pattern | Source | |
|---|---|---|
| Authorization runs in code between retrieval and generation: „the authorization check should happen after retrieval and before the documents reach the LLM“; pre-filtering by allowed ids is the alternative for narrow access | [OpenFGA, RAG authorization](https://openfga.dev/docs/modeling/agents/rag-authorization) | read |
| Pre-filter (ask the permission system first, search only what it allows) suits large corpora and narrow access; post-filter (search, then check each hit) keeps search quality for broad access and needs over-fetching | [SpiceDB with Pinecone](https://authzed.com/docs/spicedb/integrations/pinecone) | read |
| A server „MUST NOT pass through the token it received“ and must reject tokens not issued for it: an agent tier gets its own, narrowed authority | [MCP authorization, 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization) | read |
| A run's context object is local and „not sent to the LLM“; tools and hooks read it | [OpenAI Agents SDK, context](https://openai.github.io/openai-agents-python/context) | read |
| The decision sits where the permissions live, and the index or runtime enforces it: Microsoft Graph for Copilot, Glean's runtime, Elastic document-level security, Qdrant's tenant filter taken from the authenticated user | [Copilot architecture](https://learn.microsoft.com/copilot/microsoft-365/microsoft-365-copilot-architecture), [Glean](https://developers.glean.com/libraries/indexing-sdk/permissions), [Elastic DLS](https://www.elastic.co/docs/deploy-manage/users-roles/cluster-or-deployment-auth/controlling-access-at-document-field-level), [Qdrant multitenancy](https://qdrant.tech/documentation/deploy-and-scale/multitenant-search/) | |
| „Everyone in the chat may read it“ is an intersection over members, which relationship-based systems express directly (SpiceDB's intersection arrow); with Postgres already the source of truth it can be computed in the BFF | [SpiceDB schema language](https://authzed.com/docs/reference/schema-lang) | |
| A prompt-injected mail made Copilot read data outside the asker's intent („LLM scope violation“, CVE-2025-32711, fixed May 2025) | [EchoLeak paper](https://arxiv.org/html/2509.10540v1) | |

These carried [ADR-0194](../adr/0194-a-conversation-s-context-is-decided-once-in-the-bff-and-enforced-everywhere.md):
decide in the tier that holds identity and grants, carry the decision to the
agent signed and typed, keep it out of the prompt, and check again where a tool's
result enters the answer.

## Ideas not yet decided

1. Per-answer approval for an answer that would draw on personal or restricted
   material in a shared chat, after Microsoft. It would refine rule 5 of
   ADR-0193 from „stop drawing on it“ to „draw on it, and let the owner decide
   before the others read it“.
2. A scope line under every answer naming the places read and whether personal
   memory was used, after Slack's and Notion's citations; the „Mein Bereich“
   concept already shows „Gelesen: …“.
3. A golden check that asks each question as the least-privileged reader and
   fails when a source outside their reach appears, after Glean's test advice.
4. Withholding a cited source from a reader who has since lost access to it;
   the `contentLocked` path in `bff/sharing/access.ts` is where it would live.
