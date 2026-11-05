---
status: accepted
date: 2026-11-05
decision-makers: product owner, engineering
consulted: cofounder
informed: everyone working in this repo
---

# Release notes have three tiers, and the public page shows only the weekly summary

## Context and Problem Statement

Every change a customer can notice ships with a reno note (`releasenotes/notes/`, about 650 by
November 2026), and until now every note in a public section was published line by line on the
website's changelog. That is too much, for two readers. A visitor gets seventy lines a week, a
quarter of them small fixes, and nothing tells them what the week meant. A competitor reading
closely gets a map of the product: which component was rebuilt, where the weak spots were, what
was fixed the week before ("Should we really communicate changes this granularly to everyone
publicly? Reverse engineering", the cofounder's review). The owner's decision in that discussion:
the public changelog uses only the weekly summaries; a changelog as such stays, because the office
cannot be told every change one by one; the trade-off between search visibility and detail is the
owner's.

The notes are also flat. A member looking for what changed in the files or in building law reads
the whole week.

## Decision Drivers

* A customer must be able to find every change, in the product, in their language.
* The public page must not map the internals, and must stay indexable with a stable address per week.
* One source: the notes and the summaries in `releasenotes/`, linted once, translated once.
* The image builds stay hermetic: no git history, no Python toolchain, no translator at build time.
* The size rule (`scripts/check_file_size.py`): `scripts/release_notes.py` was already over 600 lines.

## Considered Options

* **Three tiers from one source**: the public website shows the weekly summaries; signed-in members
  read every note in the app, grouped by week and product area; `security`, `incident` and
  `operators` stay internal.
* **Keep the public page, fold it harder**: every note public, fixes hidden behind a toggle.
  Rejected because the reverse-engineering concern is about what is on the page at all, and a
  folded line is still in the HTML a crawler and a competitor read.
* **A per-note public flag (`highlight`) next to the summary**: rejected for now. The summary
  already is the headline, written by a person who sees the whole week; a flag on single notes
  brings back per-note public lines and a second decision per note at the moment an author knows
  least about the week. Revisit if summaries keep missing a headline a single note had.
* **A protected changelog page on the website** (sign-in on the marketing site): rejected because
  the website has no session of its own (sign-in is the app's, through WorkOS) and the app is
  already where a member is signed in.

## Decision Outcome

Chosen option: "Three tiers from one source", because it gives the customer everything and the
public the story, from the same notes.

* **Public** (`apps/website/src/data/changelog.json`, `/changelog/`, `/en/changelog/`, and an RSS
  feed per locale at `rss.xml` below each): one entry per week that has a summary in
  `releasenotes/summaries.yaml`, the summary in German and English, and nothing else. A week without
  a summary is not listed; no neutral filler line, because a page of "small improvements" weeks is
  thin content for a search engine and says nothing to a visitor. Each week keeps its anchor
  (`#r-2026-W44`) as its stable address.
* **Customers** (`apps/workspace/bff/release-notes/release-notes.generated.json`, the app's
  `/app/whats-new`, reached from the user menu and the phone's "Mehr" sheet): every note of the
  customer sections, with its section and its product area, grouped by week, newest first, filterable
  by area, the week's summary above its notes, the fixes folded. The same route serves the agent
  door as `release-note-list` (read-only, offered to outside agents and the in-product agent: "can
  it do X now?" is answered from it).
* **Internal**: `security`, `incident`, `operators`, kept in the repository and in neither artifact,
  as before.

A note's **area** is one of a fixed vocabulary that follows the rows of `VISION.md` ("What it does"):
`projects`, `documents`, `answers`, `search`, `building-law`, `bim`, `collaboration`, `tasks`,
`office-knowledge`, `administration`, `agents`, `general`. English ids, labels in the app's
dictionaries. It is a `# area: <id>` line in the note, which `task release:note` writes as a
placeholder the lint rejects until it is filled. A comment, not a key, because reno's own lint
fails any top-level key that is not a section. A note without the line (every note written before
this) gets a best guess from its file name and text (`scripts/release_notes_areas.py`); a wrong guess
is fixed by adding the line to that note.

`scripts/release_notes.py` writes both artifacts in one `publish`, from one translation cache, and the
release-notes workflow commits both. The script is split into `release_notes_rules.py`,
`release_notes_areas.py`, `release_notes_build.py` and `release_notes_translate.py`, so no file is
over the size limit.

### Consequences

* Good, because the public page reads as product news: eleven weeks of three sentences, in both
  languages, with nothing a competitor can diff.
* Good, because a member gets more than before: every note, by area, in the product they use.
* Good, because an agent can answer "what's new" from the same route the page reads.
* Bad, because the public page now depends on one person writing a summary each week. A finished
  week without one is warned about on every publish run (a GitHub annotation), and `task
  release:week -- <week>` lists the week's notes by area to write it from; the page omits the week
  until then.
* Bad, because the guessed areas are a heuristic. Annotation notes, for example, land partly under
  `documents` and partly under `collaboration`. The in-app filter is only as good as the lines
  authors write from now on.
* Bad, because the app image now changes on every note merge, like the web image already did.

### Confirmation

* `tests/test_release_notes.py`: the committed public artifact holds summaries only (no key but the
  heading and the summary), every public string has a German entry, the customer artifact holds
  every note with a known section and area, internal notes reach neither, every committed note gets
  a known area, the template offers every area, the area line is linted.
* `task release:lint` (CI's Repo checks): an unknown or placeholder `# area:` line fails; a summary
  for a week that has not started fails; summaries keep the note rules with three sentences and 500
  characters.
* `apps/website/src/lib/changelog.test.ts`: the website data has no key but heading and summary.
* `apps/workspace/bff/release-notes/release-notes.spec.ts`: the app's wire vocabulary equals the
  artifact's, and every area and section has a label in both dictionaries.
* `agent-reachability.spec.ts`, `exposure.config.spec.ts`, `list-paging.spec.ts`,
  `read-gate.spec.ts`: the route has its operation, its exposure and its paging.
* Nothing enforces that a summary gets written; the publish warning is the only signal, on purpose
  (see Consequences).

## More Information

* The rules for authors: [`docs/contributing/release-notes.md`](../contributing/release-notes.md).
* Revisit the per-note public flag if the owner wants single headline features on the public page
  for search, or if summaries are regularly late by more than a week.
