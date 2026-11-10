# Organization AI Settings: Models, Usage & Budgets

Org admins manage both features from **Organization** (top-right menu →
Organization). Members can see their own usage; everything else is
admin-only.

## AI model configuration

Choose which OpenRouter model each *agent group* runs on:

| Group | What it does |
|---|---|
| Clarifier | asks follow-up questions and drafts research plans |
| Research | the default research agent, and the one that answers every chat turn |
| Deep research | orchestrator/planner/researcher/writer for deep runs |
| Deep-research source router | routes deep-research subtasks to sources |
| Memory reflection | background pass that distills project memory |

- **Change** opens a search over the OpenRouter catalog. Only models that fit
  the group are listed (e.g. research groups require tool calling and a large
  context window) — an unsuitable model cannot be saved.
- Saving creates a **new version** (with your optional change note). New
  conversations pick the change up immediately; running conversations keep
  their current models until reconnected.
- **Version history** shows every past configuration with author and date —
  activate any older version to roll back, or *Deactivate overrides* to
  return to the built-in defaults.

## Usage & budgets

The card shows LLM spend **today** and **this month** as a bar per window:
each colored segment is one model (hover a segment or a legend entry for
exact figures and request counts); the legend below lists spend per model.

- **Limits**: every organization starts with **€10/day and €100/month**.
  Admins can change either or clear it (no limit). When a budget is
  exhausted, new chat requests are blocked until the window rolls over or an
  admin raises the limit — members see a clear message.
- **Member & project limits**: optional stricter caps per member (WorkOS
  user id) or per project (project id). They can never exceed the
  organization limits and are enforced *in addition to* them. Project
  admins may set their own project's limit.
- Costs are recorded exactly as OpenRouter reports them (USD) and compared
  against your EUR limits with a fixed deployment-configured rate. Every
  request is kept in an audit ledger (who, which project, which model, what
  cost), and every limit change records who made it.

## What ARCHOS has learned about the office

Under **Organisation → „Was ARCHOS über das Büro gelernt hat“** ARCHOS lists
habits it counted across your projects: where a Dokumentart is usually filed,
which folders most projects keep, the shape of Plannummern, the index and the
way file names write a date. A habit appears once it shows in at least three
projects (`MIN_PROJECTS` in `lib/office-conventions/extract.ts`). **Bestätigen**
keeps a line for ARCHOS even when later counts fall short, **Ablehnen** means
ARCHOS never uses it, and **Zurücknehmen** undoes either. Your organization's
operator switches this on (the `office-conventions` flag)
([ADR-0129](../adr/0129-piloti-learns-the-office-conventions.md)).

## Grundlagen des Büros

Under **Organisation → „Grundlagen des Büros“** you record the standards,
commentaries and authority directives your office owns (an ÖNORM you bought, a
commentary on the Bauordnung, an MA 37 Weisung). **Datei hochladen** stores a
file and proposes it; for a bought standard use this rather than the Büroablage's
own upload, which reads a file at once. You can also choose a document already in
the Büroablage. The proposal comes from the file name: its kind, designation,
edition, where it applies and, for a directive, the authority. Nothing reads the
text (no search, no summary) until you correct and **Bestätigen** it. For a
licensed copy you confirm that your licence covers everyone in the office, and,
separately, whether it also covers processing by the hosted AI services
(indexing, reading, quoting). Without that second confirmation the copy stays
„Nur Metadaten“: answers name the standard and its edition and say its text is
not used; **Lizenz deckt KI-Verarbeitung** gives the confirmation later. From
then on answers in your office draw on it, name its edition and last check, treat
a commentary as interpretation only and apply a directive only where its
authority decides. **Als aktuell geprüft** records a check; after a year (half a
year for a directive) the entry shows „Prüfung überfällig“ and answers say so.
**Entfernen** deletes the document and the entry. Other offices see none of it.
Every organization has it
([ADR-0163](../adr/0163-office-base-knowledge-shares-the-platform-records.md), [ADR-0175](../adr/0175-the-cut-over-removes-the-austria-only-paths-and-their-switches.md)).
