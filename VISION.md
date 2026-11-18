# ARCHOS: the vision

**ARCHOS is the workspace for architects.** A planning office runs its work in
it: every project, every process, the whole organization. ARCHOS, the agent, is
a colleague in that office who does part of the work.

This is the one document that says what the product is. Every README, guide,
prompt and design note describes ARCHOS this way. When one of them reads like a
question-answering tool about building law, it is out of date, and fixing it is
part of the change that noticed it.

## Why it exists

An architect's work is spread across a file server, a document-exchange portal,
mail, CAD, a building model, spreadsheets, and the heads of the people who did
the last project. A building law sits behind every decision, and nobody keeps
it all in view. The office's knowledge exists, in hundreds of documents and
past projects, but nobody can find it when it would help.

ARCHOS puts the work in one place where an agent can read everything the office
holds, and lets that agent take part in the work. The value is neither the
storage nor the chat. It is a colleague who has read the whole project and
works in it.

## Who it is for

- **The organization:** an architecture or planning office, its projects, its
  people and roles, its Büroablage, its conventions. Nothing crosses from one
  organization to another.
- **The people in it:** architects, project leads, drafters, site supervision
  (ÖBA), office management, and the specialist consultants (Fachplaner) they
  work with.
- **Every phase of a project:** from the first facts through Entwurf,
  Einreichung, Ausführung and the project's close, and what the office learns
  from it for the next one. Today ARCHOS is strongest from the intake to the
  Einreichung. The direction is the whole life of a project.

## What ARCHOS does

ARCHOS helps wherever an architect spends the day. Building law is one of these
places, not the frame around them.

| The architect's work | What ARCHOS does there today |
|---|---|
| Starting a project | The Einrichtung asks for the facts that decide the rest: Bundesland, Gebäudeklasse, Bauwerke, uses, plot. ARCHOS derives which OIB-Richtlinien apply, keeps a Steckbrief of the people involved, and keeps the profile current as the project establishes new facts. |
| Files and the Büroablage | Folders, uploads of whole folders and ZIPs, Office files shown and cited page by page. ARCHOS reads every upload and says what it is, what it found, which of its Fassungen is current, and what is missing or could not be read. Sensitive uploads are screened before any model sees them. The Büroablage holds the office's own documents, on every project. An Outlook archive can be filed mail by mail. |
| The building model | IFC models in the browser: structure, quantities (Raumbuch), revisions, 3D with sections and measuring. ARCHOS reads and measures their elements and checks the model against the OIB requirements that apply: each rule passes, fails, or names the property the model would have to publish to decide it, with the threshold and the clause. A person's confirmations are recorded in the Prüfbuch, and the open points go back to ArchiCAD or Revit as BCF. |
| Questions about the work | About a document, a folder, a decision, the model, the law. Answers come from the project's files, the workspace's own records, the Büroablage, the legal corpus and the web, whichever the question needs. Every claim shows where it comes from (a cited passage, a record, a measurement, or an Einschätzung marked as one), and the derivation is visible. |
| Handing over work | Aufgaben run on their own under the requester's permissions. Zeitpläne repeat them. A Tiefenrecherche plans, researches, checks and files a report. Skills hold the office's own procedures. |
| Writing | ARCHOS drafts Aktenvermerke, Protokolle, Checklisten, Flächenaufstellungen and reports into the project. A person releases them (Freigabe), ARCHOS revises them from a reviewer's comment, and a released document counts as office knowledge. ARCHOS proposes moves, renames and folders, and nothing changes until someone accepts. |
| Working as a team | Shared chats, mentions, an inbox, assignments ("Verantwortlich"), live presence, custom roles and folder access per role, a download log. |
| What the office knows | Project memory, the office's standing instructions, similar closed projects, what an authority asked for before (Behörden-Gedächtnis), and the experience a closed project leaves behind. Closing a project proposes what to clear out and records what the office learned. |
| Building law and norms | The OIB-Richtlinien, Austrian law via RIS, a curated norm register, and norms an office uploads itself, cited at the passage. One capability among the others, and a deep one. |

## Where it is going

These are directions with a document behind them, not promises:

- **The office's own agents.** The workspace is open to them. Anything a person
  can do in ARCHOS, their agent (Claude, Cursor, their own) can do through
  ARCHOS's MCP server, with the person saying yes or no
  ([`docs/architecture/agent-surface.md`](docs/architecture/agent-surface.md)).
- **The office's past as knowledge.** An importer that reads an office's
  archive for facts and decisions, and Referenzblätter for tenders
  ([`docs/roadmap/office-experience.md`](docs/roadmap/office-experience.md)).
- **Reading drawings, not only text.** Measuring from 2D drawings
  ([`docs/roadmap/plan-measurement-from-drawings.md`](docs/roadmap/plan-measurement-from-drawings.md)).
- **Requirements that follow the project.** The model check against the OIB
  requirements works today (the Prüfbuch,
  [`docs/roadmap/ifc-compliance-ledger.md`](docs/roadmap/ifc-compliance-ledger.md)).
  The direction is one record of what applies and what is shown, across the
  drawings and documents as well as the model, carried across revisions
  ([`docs/roadmap/compliance-derivation-graph.md`](docs/roadmap/compliance-derivation-graph.md)).
- **An agent that holds work.** Longer tasks with a goal, a plan, a review and
  a decision that comes back
  ([`docs/roadmap/agentic-workspace-architecture.md`](docs/roadmap/agentic-workspace-architecture.md)).

## What ARCHOS is not

- **Not a question-answering tool.** A question is one way to hand ARCHOS work.
  The unit of the product is the project, the document and the task, not the
  chat message.
- **Not a compliance assistant.** ARCHOS knows building law well, and it uses
  that knowledge in the work. It does not reduce the work to checking rules.
- **Not a file server with a chatbot.** ARCHOS reads the files, so the
  workspace knows what is in them.
- **Not the Entwurfsverfasser or the Behörde.** ARCHOS prepares, checks and
  suggests. People decide and sign.

## Principles

1. **Work, not answers.** Ask what the architect is trying to get done, not
   which question to answer. A feature that only makes the chat smarter is
   suspect. A feature that removes a step from the office's day is not.
2. **The office's language.** Product copy is German and uses the words of the
   trade. Never call a file a plan: nothing knows a file is a drawing until its
   Dokumentart says so. Say Dokument, Datei, Fassung, Stand (`CONTEXT.md`).
3. **Grounded and traceable.** A claim resolves to a passage a person can open.
   An action leaves a trace a person can follow. What ARCHOS cannot ground, it
   does not present as fact.
4. **Suggest, then confirm.** ARCHOS proposes. A person confirms anything that
   changes the office's record: a Dokumentart, a Fassung, a fact in the project
   profile, a document's Freigabe.
5. **The office's own knowledge first.** The project's documents, the
   Büroablage, past projects and the office's conventions come before general
   knowledge. The base corpus serves the office, never the reverse.
6. **The whole organization.** Projects, people, roles and knowledge belong to
   the organization, and what one project learns, the next one can use.
7. **AI-native, not AI-added.** The agent works on the same file system,
   folders, Fassungen and records the people do, through the same API
   (ADR-0055). Everything it does is observable (Langfuse, ADR-0089).

## Staying necessary

Product-market fit is not kept, it is earned again. Attackers keep coming, from
frontier labs and from teams of three, so the product disrupts itself before
they do. Source: Cleo Lant, "Find PMF again", PostHog newsletter, 2026-08-25
(<https://posthog.com/newsletter/find-pmf-again>), a vendor post with anecdotal
evidence. These are the axioms we take from it.

1. **Write down how we die.** Keep three or four one-line threats, each naming
   who or what would make the workspace unnecessary to an office. Revisit them
   whenever the roadmap moves. A first draft, for the product owner to correct:
   - A general agent from a frontier lab, given the office's file server and
     mail, does enough of the work that nothing is needed around it.
   - The CAD and BIM vendors put an agent inside ArchiCAD or Revit, where the
     drawings already are.
   - The document-exchange portal, or an authority's own e-submission, adds
     the checks and the record, and the office never leaves it.
2. **Bet against ourselves, and judge the bet as a seed bet.** A bet that could
   replace part of today's product gets a small team and a blank slate. Before
   it starts, write down the criteria it will be judged on, its resources and
   the date of the decision to kill it or carry on. Do not compare its numbers
   with the established product's. Writing them down first prevents both an
   early kill and a bet that is funded forever.
3. **When offices assemble the next version themselves, the demand is proven.**
   An office that wires its own agent to the agent door, to do what the
   workspace does not, is the strongest signal we get. Study what they built.
   It is a product signal, not a support case.
4. **Build first, then win the existing offices over.** Offices judge the
   product they use well and a category that does not exist yet poorly
   ("why risk what works?"). Validate a new category with something real
   behind a beta, not with a survey beforehand.
5. **Ask the disappointment question, early and often.** "How disappointed would
   you be if this disappeared?" Ask the architects on the team and the offices.
   Around 40% "very disappointed" is the usual bar. The team will tell you the
   truth before churn does, but only if you ask.
6. **Usage overrules vibes, including the owner's.** Vibes decide what to try,
   not what to keep building. Session replay and its summaries
   ([`posthog-migration.md`](docs/observability/posthog-migration.md)) and the
   Langfuse traces are the record. Existing offices judge against their old
   workflow, and new ones show what the product invites. Read both and do not
   average them.
7. **Build on what an attacker cannot copy.** Ours is the office's work in one
   place: its documents read and cited, the project record, the Fassungen, what
   the office knows, and the trust to hold it. A new interface may share no code
   with today's UI, but it shares that data and the agent door (ADR-0055,
   ADR-0122).
8. **Ship before it is ready.** Losing most comparisons, renaming things and
   killing a feature two weeks after it shipped are what self-disruption looks
   like. If none of that is happening, we are not disrupting ourselves.

## How to use this document

- **Deciding a feature:** does it help an architect do their work, in the
  office's language, in the place they already work? Building law is a means
  to that, never the measure. Then [Staying necessary](#staying-necessary):
  which threat it answers, and what usage, not opinion, says to keep building
  it.
- **Writing a doc, a prompt or copy:** lead with the work. Mention the legal
  corpus where it is the topic, and describe it as the capability it is.
- **Disagreeing with this document:** change it in a pull request. A vision
  nobody may edit is one everybody ignores.

The engineering detail behind the agent's direction is in
[`docs/roadmap/agentic-workspace-architecture.md`](docs/roadmap/agentic-workspace-architecture.md).
The domain words are in [`CONTEXT.md`](CONTEXT.md).
