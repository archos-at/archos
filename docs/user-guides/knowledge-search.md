# Knowledge Search

ARCHOS draws on several kinds of source when it answers your questions. This guide explains what it searches, what decides which sources a question may use, and how you steer it.

---

## What ARCHOS Searches

ARCHOS searches these sources on its own — you don't need to ask it to "search" explicitly. The headings use the shelf names the chat shows.

### 1. Basiswissen: OIB-Richtlinien and the law corpus

The OIB (Österreichisches Institut für Bautechnik) guidelines are pre-ingested into a persistent collection named `oib_knowledge`. These PDFs cover Austrian building code regulations. ARCHOS consults this base whenever it needs regulatory or technical building information.

This collection is part of every question's scope and is **never** auto-deleted.

### 2. Büroablage (organization-wide)

Documents in the office's **Büroablage** are stored in collection `archiv_{orgId}` and searched from every chat of everyone in the organization, alongside the project's own documents. See [The Büroablage](documents.md#the-büroablage-adr-0024).

### 3. Projektwissen (project-scoped)

Documents in a project's **Dateien** are ingested into collection `proj_{projectId}`. Only people with access to that project can search them, and ARCHOS searches them in every chat of that project. How to upload them: [Uploading Documents](documents.md#uploading-documents).

### 4. Private Sitzung (this chat only)

Files attached to a conversation (dropped over the chat, pasted, or picked with the paperclip) are stored in collection `s_{conversationId}` and are searchable only within that conversation. They are temporary: by default the conversation's files are deleted 24 hours after the last one was added.

### 5. The web

ARCHOS can search the web for current information (shown as „Webquelle“), unless your organization has switched web search off (see [Web Search](#web-search)).

ARCHOS can also look into the office's other projects when your question calls for it; who may see what it finds there is described in [Searching other projects](chat.md#searching-other-projects).

---

## Which Sources Are Searched

The chat has no control for choosing sources at the moment: every question goes out with every available source enabled. A conversation that saved a narrower selection while that control existed still restores it. When no source and no file is available at all, a warning above the composer says so: „Keine Datenquellen ausgewählt und keine Dateien verfügbar. …“ ([Data sources](chat.md#data-sources)).

What does narrow a question:

- **A file attached to the chat** binds the next message to that file: „Fass den Inhalt zusammen“ reads the attached file, not the rest of the project or the Büroablage.
- **Your organization's settings** decide whether web search exists at all (below).
- **Your access** decides which projects and folders can be searched: ARCHOS's server builds the scope from the chat's project and conversation, never the model.

### Telling ARCHOS What to Search

Natural language instructions work well:

- *"Search my documents for information about fire safety regulations"*
- *"Find info from the OIB about staircase dimensions"*
- *"Look in my uploaded files for the structural analysis report"*
- *"Search the web for current Austrian building code updates"*

ARCHOS searches automatically when it decides it needs information it does not have, and it can also open a folder and read a document directly; you can ask it to search explicitly as well. Asking **which files** sit on a shelf is answered from that shelf only; see [The composer](chat.md#the-composer).

---

## How Results Are Presented

What ARCHOS found appears with the answer as source cards and chips:

- **Each source names where it comes from** — its kind (OIB-Richtlinie, Projektwissen, Büroablage, Webquelle …), the document's name, the edition when the title states one, the place („S. 7“, „Pkt. 3.1.1“) and the answer's marker („[1]“)
- **Clicking a chip opens the source** — a document opens at the cited page, with the passage marked where it can be found; web and RIS sources link out
- **What was retrieved but not cited** is folded into one card marked „Nicht zitiert“

The details are in the chat guide: [Herleitung](chat.md#herleitung-what-archos-looked-up-and-what-the-answer-stands-on) and [Answer sources](chat.md#answer-sources-belegt-durch).

---

## Document Summaries

Each successfully ingested document gets a short **summary** (if summarization is enabled in the configuration). In a project's Dateien and in the Büroablage it is the description under the file name on the file card, and the file's preview shows it too. ARCHOS also uses the same summaries to know which documents are available before searching them.

Summaries are generated during ingestion using the configured `summary_model` LLM and stored in a summary registry (SQLite by default, PostgreSQL in a deployment that configures it), which is **separate** from the search index. If summary generation fails during ingestion, a deterministic fallback summary (derived from the document's own text) is generated instead, and a reconciliation pass after every ingestion run backfills any document that still ended up without one — so a document should no longer end up fully searchable while permanently missing from the summaries. If you ever see a document answer targeted search but not "what documents do I have" style questions, it should resolve itself the next time that collection is ingested into; see `docs/architecture/backend-deep-dive.md` §6 for the technical detail.

---

## Web Search

Web search is on for every organization unless it is switched off. While it is on:

- ARCHOS can fetch and cite current information from the internet
- Web results supplement the office's documents and the base knowledge

Whoever may change the organization's settings switches it under **Organisation → Organisationseinstellungen → „Websuche“**. Switched off, web search is blocked on the server for every member of the organization, and ARCHOS says when it could not check the web instead of answering as if it had.

---

## Collection Scoping

The system determines which collections to search for each request. This scoping is transparent to the user:

- **Project context** — if you are working in a project, `proj_{projectId}` is included
- **Conversation context** — if you have a conversation open, `s_{conversationId}` is included
- **Büroablage** — `archiv_{orgId}` is included for every signed-in member of an organization
- **Base knowledge** — `oib_knowledge` is always included as the default collection

For technical details, see the [Collection Scoping](../technical-reference/collection-scoping.md) reference.
