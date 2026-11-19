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

## Normen & Richtlinien in der Büroablage

The standards, guidelines, authority directives and commentaries your office
owns (an ÖNORM you bought, an MA 37 Weisung, a commentary on the Bauordnung)
live in the Büroablage, on the tab **Normen & Richtlinien** beside **Ordner**.
Each is called a *Norm* for short; its *Art* says what it is. The tab's tool row is
the Ordner tab's: search, „Alle Arten“, „Thema anlegen“, **Hochladen**, and ⋯ with
„Aus Ordnern übernehmen“ (a document already in the Büroablage) and „So funktioniert es“.

**Adding norms.** The Büroablage has one **Hochladen**, on either tab. ARCHOS
reads the file names as they arrive: a norm goes straight under Normen &
Richtlinien, never into the folder you uploaded to, and one dialog opens for the
norms: Art, Bezeichnung, Ausgabe and Thema, proposed from the name, which you
correct and **Bestätigen**. **Keine Norm** turns a row back into an ordinary file
in the folder it was uploaded to (the top level if that folder is gone), and ARCHOS
does not offer it as a norm again. **Später** leaves the rows waiting under „Zu
bestätigen“. A file that is a newer Ausgabe of a norm you hold is added beside the
earlier one; a second copy of an Ausgabe you hold is recognised as a duplicate,
whatever the file is called (a file whose name is already taken is kept as
„Name (2)“). Ordinary files go to the folders (the toast's „In Ordnern zeigen“
goes there); an OIB-Richtlinie stays an ordinary file, and ARCHOS says it already
knows it. A file in a folder can still be filed with **Als Norm führen**. Nothing
reads a norm's text (no search, no summary, no answer) until it is confirmed.
**Nicht mehr als Norm führen** takes a norm off the tab at once and keeps its file
in the Ordner; **Rückgängig** in the message that follows brings it back as it
was, confirmed, with its Ausgaben, checks and Thema. **Als Norm führen** on that
file later starts a fresh proposal. **Thema anlegen** adds a topic to sort norms
into. ARCHOS does not ask about a norm's licence: a confirmed norm is read,
whether you bought it or it is freely available.

**Norms in a project or in a folder.** A norm uploaded to a project is offered
for the Büroablage, where every project finds it. Once ARCHOS has read the
upload, the same dialog opens in Dateien with Art, Bezeichnung and Ausgabe and
asks where the norm belongs: **Büroablage (empfohlen)** if you manage the
Büroablage, **Für die Büroablage vorschlagen** otherwise (whoever manages it
decides in the Postfach, checking the same values), **Nur dieses Projekt**, or
**Später**, which leaves the offer above the files. A norm moved or taken over
this way is confirmed with the values you saw, so answers keep using it, and it
needs its Ausgabe. When nobody who manages the Büroablage may write in the
project, ARCHOS says so and names who could decide once given access; nothing is
sent. A moved norm leaves a reference in the project folder; if it is later
taken off the norms, the reference says it still lies in the Büroablage and opens
the file. Norms you had filed in
ordinary Büroablage folders are found when you open the folder, which offers
**Unter Normen & Richtlinien führen**, which moves them and opens the norm dialog
for them, or **Im Ordner lassen**. An ordinary folder cannot be moved under
Normen & Richtlinien.

**The Postfach** shows only what needs your decision: a norm someone suggests
for the Büroablage, and a norm you hold that is no longer the binding edition for
an active project. Everything else stays where the norm is: in the folder, above
a project's files, or under Normen & Richtlinien.

**Stand.** Where the platform's norm directory lists a norm with dated editions,
its Stand comes from there: „Aktuell“ when you hold the edition in force today,
„Neuere Ausgabe“ when a newer one applies, and the Postfach tells you when one
comes into force, with the projects whose reference day falls after it. Every
other norm keeps a manual check: **Ist noch aktuell** records it, and after a
year (half a year for a directive) it shows „Prüfung fällig“.

**In answers.** Answers in your office draw on confirmed norms, name the
Ausgabe they used and use the one in force on the project's reference day (today
when the project has none, and they say so). When the directory shows that
another Ausgabe was binding that day and your office does not hold it, the
answer says which one and asks you to upload it instead of answering from your
copy. A commentary is used as interpretation only, and a directive only where
its authority decides. Other offices see none of it. The tab appears once
office standards are switched on for your organization
([ADR-0163](../adr/0163-office-base-knowledge-shares-the-platform-records.md), [ADR-0175](../adr/0175-the-cut-over-removes-the-austria-only-paths-and-their-switches.md), [ADR-0185](../adr/0185-a-project-norm-goes-to-the-office-shelf-as-a-copy-and-leaves-a-reference.md)).
