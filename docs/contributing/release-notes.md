# Release notes

Every change a customer can notice ships with a release note, in the same pull
request that makes the change. Three tiers read them
([ADR-0154](../adr/0154-release-notes-have-three-tiers-and-the-public-page-shows-the-weekly-summary.md)):

| Tier | Where | What it shows |
|---|---|---|
| Customers | the app, `/app/whats-new` (user menu, "Neuerungen"), signed-in members only | every note of the customer sections, in German and English, grouped by week, filterable by product area, fixes folded |
| Public | the website, `/changelog/` and `/en/changelog/`, plus an RSS feed below each (`rss.xml`) | the weekly summary from `releasenotes/summaries.yaml`, and nothing else. A week without one is not listed |
| Internal | the repository only | `security`, `incident` and `operators` notes |

No single note is on the public page: a line-by-line public changelog mapped the
product's internals for anyone reading it closely, and told a visitor nothing
about what the week meant. Security and severe fixes are written down the same
way and kept in the repository: the notes are product news, not a bug register.

- **Tool:** [reno](https://docs.openstack.org/reno/latest/), OpenStack's release-note
  manager. One YAML file per change, under `releasenotes/notes/`.
- **Rule:** [AGENTS.md](../../AGENTS.md), the "Change what a customer can notice"
  row. Enforced on every PR by the release-note step of the **Repo checks** job
  in [`ci.yml`](../../.github/workflows/ci.yml), which goes by file, not by what
  the diff does: a PR that touches a product file
  ([`ci/require_release_note.py`](../../ci/require_release_note.py)) and adds
  no note fails. A note in any section counts, an internal one included, so a
  security or severe fix satisfies the check without reaching any reader. A
  change no user can notice, a comment or a refactor, takes the
  `no-release-note` label instead. The job reads the label when it runs, so
  a label added after the push needs only a re-run of the **Repo checks**
  job, not a new commit.
- **Destinations:** the pipeline writes two artifacts.
  `apps/workspace/bff/release-notes/release-notes.generated.json` (every customer
  note with its section and area, both languages) is read by the app's
  `/app/whats-new` and by `GET /api/release-notes`, which is also the agent door's
  `release-note-list`. `apps/website/src/data/changelog.json` (the weekly
  summaries, both languages) is rendered by `apps/website/src/views/ChangelogView.astro`.
  Both images are built from the repo (`ci/image_inputs.py`).
- **Reader:** the architect using the product. Not the reviewer of your diff, and not
  the people who run the platform.

## Writing one

```bash
task release:note -- re-index-projects      # creates releasenotes/notes/re-index-projects-<hash>.yaml
$EDITOR releasenotes/notes/re-index-projects-*.yaml
task release:lint                           # the same check CI runs
```

reno picks the filename, a slug plus a random suffix, which is why two
branches never collide on the same note file even when they both add one.

Set the area line the template starts with, then keep exactly the sections you
need and delete the rest:

```yaml
---
# area: projects
features:
  - >
    Projects can now be re-indexed from the settings page, so documents that
    failed the first time are picked up without contacting support.
```

| Section | In the app | For |
|---|---|---|
| `features` | yes | Something the reader could not do before |
| `improvements` | yes | Something they already had, now better |
| `fixes` | yes, folded | An ordinary thing that used to go wrong: a button, a label, a slow screen |
| `deprecations` | yes | What is going away, and what replaces it |
| `upgrade` | yes | Only when the reader has to do something themselves |
| `other` | yes | Genuinely user-visible, fits nowhere above |
| `security` | **never** | A vulnerability, a hardening, a dependency bumped for a CVE, a permission that was not enforced |
| `incident` | **never** | A severe fix, something that should never have happened: data lost, or kept after it was deleted; a legal hold or permission that did not hold; an answer passed as checked when it was not; a false claim on the website |
| `operators` | **never** | Only the people running the platform can act on it |
| `prelude` | as the summary | Rarely: a summary for a tagged release. Weeks use `summaries.yaml` |

None of them is on the public page; it shows the week's summary.

A customer who must hear about a security or incident fix is told directly, by
the people who run the platform; a changelog line only advertises the hole.

The section list lives in [`releasenotes/config.yaml`](../../releasenotes/config.yaml);
the app's labels for the customer sections live in its `whatsNew` dictionaries,
and `release-notes.spec.ts` fails a section without one. `INTERNAL_SECTIONS` in
[`scripts/release_notes_rules.py`](../../scripts/release_notes_rules.py) is what
keeps `security`, `incident` and `operators` out of both artifacts.

### The product area

Every note names the one area of the product where the reader meets the change,
in a comment line at the top: `# area: documents`. The app's list filters by it.
A comment and not a key, because reno lints every top-level key as a section.

| Area | Where the reader meets it |
|---|---|
| `projects` | Creating and setting up a project, the Steckbrief, closing a project |
| `documents` | Files, folders, uploads, Fassungen, previews, the Büroablage, the bin and the archive, drafts and Freigabe |
| `answers` | Asking in the chat: answers, sources, cards, the Herleitung, exports of an answer |
| `search` | Finding things: the search page, Ctrl+K, word search across documents |
| `building-law` | OIB-Richtlinien, laws from the RIS, the norm register, site rules |
| `bim` | IFC models, the Raumbuch, the Prüfbuch, BCF |
| `collaboration` | Anmerkungen and the review, mentions, the Postfach, notifications, shared chats |
| `tasks` | Aufgaben, Zeitpläne, runs, deep research and its reports, skills |
| `office-knowledge` | Memory, standing instructions, similar projects, what the office learned |
| `administration` | The organization, roles and rights, budgets and usage, sign-in, retention |
| `agents` | The office's own agents connected to the workspace |
| `general` | Everything else: navigation, the phone, language, the website |

`AREAS` in [`scripts/release_notes_areas.py`](../../scripts/release_notes_areas.py)
is the source; the app's `RELEASE_NOTE_AREAS` and its dictionaries are held to it
by `release-notes.spec.ts`. `task release:lint` fails an unknown area, a second
area line, or the template's placeholder left in. A note without the line, which
is every note written before areas existed, gets a guess from its file name and
text; when the guess is wrong, add the line to that note. Adding an area means
the vocabulary, the app's wire and both dictionaries in one change.

## The house rules

A note in a customer section is **shown verbatim to every member of every office**,
and the week's public summary is written from it, so it is product copy that
happens to live in the repository. The internal sections
follow the same rules, with four sentences instead of two: the next person
reads them, and an entry can move to a customer section. `task release:lint`
enforces every rule marked *lint*, and each failure says how to fix it.

1. **English.** *(lint)* The German page is translated from the English. A note
   written in German used to be published as the "English" text and then
   translated from German into German, which is how 344 German sentences ended
   up on `/en/changelog`. The check counts German and English function words
   outside quotation marks, so an English note may quote a German label such as
   „Von Piloti erstellt“. It agrees with `py3langid` on every note in the repo.
2. **For the architect.** Say what they can now do, or what stopped going wrong
   for them. Not how you did it.
3. **At most two sentences and 400 characters.** *(lint)* One for what
   changed, one for why it matters. An unrelated change gets its own entry;
   the mechanism goes in the PR description.
4. **No internal names.** *(lint, in part)* No issue numbers, commit shas, file
   names, repository paths, module or component names, and no links other than
   to the website (the domain in `packages/brand/identity.json`, or the former
   piloti.at until the domain cutover). Name things the way the UI names them.
5. **Plain text.** *(lint)* No reStructuredText, backticks or code fences.
6. **Operators go under `operators`.** *(lint)* The Platform area, model
   defaults, deployment, migration or environment settings: nobody in an
   architecture office can act on them. Phrasing such as "platform operators",
   "Platform →", "new installations" or "environment variable" outside that
   section fails the lint. Office administrators (roles, budgets, the
   organization's instructions) are customers; their notes stay public.
7. **Security and severe fixes go under `security` or `incident`.** *(lint, in
   part)* A customer entry that names a vulnerability, a remote-code flaw, a CVE,
   an exploit, a permission bypass or data loss fails the lint
   (`SEVERE_PATTERNS`). The list is short on purpose, so most severe fixes pass
   it: the question to ask is whether a reader would learn that Piloti once
   lost, kept or showed what it should not have. If so, it is an `incident`.
8. **Plain words.** *(lint)* A customer entry does not name the services under
   Piloti, the formats they speak, or the mechanics of shipping and running
   software. The list is `PUBLIC_JARGON` in
   [`scripts/release_notes.py`](../../scripts/release_notes.py); the failure
   names the word it found. The classes are below.

### Words a public entry does not use

`PUBLIC_JARGON` is the source of truth. If this section and the list disagree,
the list is right and this section is stale. It holds four classes:

- **The services under Piloti:** databases, object storage, the model gateway,
  the tracing platform, and the platforms we run them on.
- **Interfaces and formats:** how one program talks to another, and the data it
  sends. API, SDK, webhook, endpoint, socket, JSON, YAML, schema, payload.
- **Shipping and running:** how software is released and where it runs.
  Deploy, staging, pipeline, commit, branch, repository, container, cluster,
  worker, and the data steps (migration, backfill, ingestion).
- **Search, the model and the controls around them:** index, embedding, token,
  prompt, cache, queue, configuration, environment variable, feature flag,
  latency, trace, metric, rate limit.

The German terms are the same classes in German. The Piloti screens' own words
are not on the list: Papierkorb, Quarantäne, Archiv, Steckbrief, Fassung and the
rest are how the reader knows the product, so they stay.

How the lint matches: whole words, ignoring case. A trailing `s` or `es` counts,
so `APIs` and `indexes` are caught. A longer word that starts with a term is a
different word, so `Tokenizer` and `Kapitel` pass. A space in a term matches any
space; a hyphen is literal. Quoted labels are checked as well. A label with one
of these words in it is a sign to describe the thing rather than quote it.

The German check is on the exact words listed. An inflected or compound form
that is not on the list (`Konfigurationsdatei`, `Konfigurationen`) passes the
lint. When you meet one, add it to `PUBLIC_JARGON` in the same change.

**Rewriting a term.** Write what the reader sees or can do, in the words the
screen uses, and leave the system out of it.

| Says | Writes instead |
|---|---|
| "Results are cached, so repeat questions are faster." | "Repeat questions come back faster." |
| "Re-indexing runs after each upload." | "Uploaded documents become searchable without a manual step." |
| "Set the environment variable to change the default model." | Under `operators`: "The default model can now be changed under Platform → Models." |

If the sentence only makes sense with the jargon word in it, the entry is about
the system, not the reader. Move it to `operators` (the platform), `security` or
`incident`, or leave it out.

### Good and bad

```yaml
features:
  # Good: what the reader can do, in the words of the UI.
  - >
    Whole folders can now be uploaded, with Ordner hochladen or by dragging the
    folder onto the file list. Files Piloti cannot read are rejected one by one.

  # Bad: German. Write the English; keep your German for de.json (see below).
  - >
    Ganze Ordner lassen sich jetzt hochladen.

fixes:
  # Good: the effect, then why it matters.
  - >
    Uploading a corrected document under the same name now replaces the old one
    instead of adding a second copy that Piloti could no longer find.

  # Bad: the mechanism, and a module name.
  - >
    The ingest dedup now keys on filename, so RerankStage no longer sees stale
    chunks.

  # Bad: three sentences retelling the bug.
  - >
    Uploads failed. The cause was a race in the upload queue. It is fixed.

operators:
  # Right section: only the people running the platform can act on it.
  - >
    The reasoning effort set under Platform → Models now applies to every
    agent, within a minute of saving.
```

### If you wrote the German first

Keep it. Write the English note, then add the pair to
`releasenotes/translations/de.json` (`{"en": "<your English>", "de": "<your
German>"}`); the publish step uses a cached translation instead of calling the
translator. Hand-written German beats machine German; it is how the notes
rewritten in September 2026 kept their authors' wording.

## Weekly groups and summaries

Nothing is tagged yet, so both artifacts group notes by the **ISO week** they
shipped in (`2026-W39`, Monday to Sunday). Once `git tag` produces versions,
notes group under their version instead, with no configuration change.

A note's week is the day of the **commit that first added the file** (renames
keep it). reno itself hands back the sha of a note's latest revision, so before
this, correcting a typo in an August note moved it to the week of the fix. Now
an old note can be edited freely: reno publishes the new text, and the note
stays where it shipped.

Each week's summary, in
[`releasenotes/summaries.yaml`](../../releasenotes/summaries.yaml) keyed by the
week id, is **the whole public changelog** for that week; in the app it stands
above the week's notes. It is written by a person after the week: what an
architect would tell a colleague about it, the headline changes in the words of
the screens. English, at most three sentences and 500 characters, linted and
translated like a note; a key for a week that has not started fails the lint.

```bash
task release:week -- 2026-W45    # the week's notes by area, to write the summary from
```

Leave out what maps the internals: no fix that tells a reader where the product
was weak, no mechanism, no component. A week without a summary is not on the
public page, and every publish run after the week is over warns about it (a
GitHub annotation on the workflow). The lint does not fail on a missing summary,
on purpose: one person writes them, and failing every pull request until they do
would make that person everyone's blocker.

### The weekly notice in the app

The newest summary is also shown once to every signed-in member, in a small
„Neu diese Woche“ notice in the app, until they close it, press Escape, follow
its link or choose „Nicht mehr anzeigen“; then never again for that week, on
any device (`user_preferences.last_seen_release_week`). A week without a summary
shows nothing, which is one more reason to write it. Someone new to the product,
whom a tour is about to greet, is not shown it. The person turns it back on
under Profil. The rules: ADR-0154, "Amendment".

## What happens on merge

1. The PR merges to `develop`.
2. [`release-notes.yml`](../../.github/workflows/release-notes.yml) runs
   `scripts/release_notes.py publish`: reno reads the notes **through git
   history**; each new English sentence is translated into German once and
   cached in `releasenotes/translations/de.json`.
3. Both regenerated artifacts, `apps/workspace/bff/release-notes/release-notes.generated.json`
   and `apps/website/src/data/changelog.json`, are committed back to
   `develop`. Publishing runs on pushes to `develop` only, and the push is
   authenticated as the `RELEASE_PAT` owner when that secret is set (falling
   back to `GITHUB_TOKEN`), because the branch ruleset requires changes to
   arrive via pull request.
4. That commit changes `apps/workspace` and `apps/website`, so CI rebuilds both
   images, the staging deploy rolls them out, and the note is in the app (and
   the summary on the site). (Until 2026-10-29
   the file lived in the retired public site, which no image built: the bot's
   commits from before then changed a file nothing served.)

### Translation

`OPENROUTER_API_KEY` (repository secret) drives the translation, with
`RELEASE_NOTES_TRANSLATION_MODEL` (repository variable) selecting the model.
`releasenotes/translations/de.json` holds one `{"en": …, "de": …}` pair per
sentence, sorted by the English text, so a note is paid for once and an unchanged
note is never re-translated. (The lookup key is derived from the English text on
load rather than stored: a digest sitting in a JSON file reads as a credential to
every secret scanner, and JSON cannot carry an inline allowlist pragma.)

Changing a note's English makes it a new sentence: the next publish translates
it and prunes the old pair. Without the key the pipeline still runs and
publishes the English text on the German page, with a warning in the log.

German on the page follows German typography: „…“ quotes and the spaced
Gedankenstrich (–), never the English em dash. To fix a machine translation,
edit the German side of the entry in `de.json` and run `task release:changelog`.
The cache is the source of truth and the translator never overwrites an entry
that exists.

### The generated files

Both artifacts are generated. Do not edit them; if two branches conflict in
one, regenerate rather than hand-merge:

```bash
task release:changelog
```

They are committed rather than built on demand because reno needs git history
and the images are built from a bare working tree. It needs a full clone: in a
shallow one reno fails with a `KeyError` on a missing commit
(`git fetch --unshallow`).

## Setup checklist (once, per repository)

- [ ] Repository secret `OPENROUTER_API_KEY`, without which the German page shows English.
- [ ] Repository secret `RELEASE_PAT`, a fine-grained PAT with `contents: write`
      on this repository, owned by an admin whose RepositoryRole bypass is listed
      on the `develop` rulesets (the ruleset requires pull requests, and GitHub
      refuses the Actions integration as a bypass actor). Without it the publish
      push falls back to `GITHUB_TOKEN`.
- [ ] A `no-release-note` label exists, for changes no user can observe.

## Commands

| Command | What it does |
|---|---|
| `task release:note -- <slug>` | Start a note |
| `task release:lint` | House rules + `reno lint` (CI runs both); also checks the area line and `summaries.yaml` |
| `task release:preview` | reno's own report, grouped by release, `operators` included |
| `task release:week -- <week>` | One week's customer notes by area, to write its summary from |
| `task release:changelog` | Regenerate both artifacts (app and website) |
