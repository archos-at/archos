# What ARCHOS can do

Every capability a customer can reach today, by area, with where it lives in the
app and what ARCHOS itself does there. UI names are the German strings the app
shows. A change that adds, renames, moves or removes a capability updates its row
in the same commit.

Built from the code on 2026-11-22. Where a page is gated, the gate is named.
The column **Needs a yes** says whether a person confirms before the record
changes ([VISION principle 4](../../VISION.md#principles)).

## The three places

Everything below belongs to one of three places. Naming the place is how a
person knows who sees a thing.

| Place | Who sees it | What lives there today |
|---|---|---|
| **Ich** (the person) | Only the person | Mein Gedächtnis, Profil, private chats (every chat starts private) |
| **Projekt** | The project's members, by role | Chats once shared, Dateien, Modelle, E-Mail-Eingang, Offene Punkte, Projektgedächtnis, Aufgaben, Übersicht |
| **Büro** (the organization) | Everyone in the office, by role | Büroablage, Normen & Richtlinien, Skills, Anweisungen, Organisation |

## Projects

| Capability | Where | What ARCHOS does | Needs a yes |
|---|---|---|---|
| List, filter (Aktiv, Ruhend, Abgeschlossen) and search projects | Projekte (`/app/projects`), „Weitermachen“ first | — | — |
| Create a project, running or closed (as a reference) | Projekte › Neues Projekt (dialog) | — | — |
| Switch project | Rail › project selector; phone › Mehr | — | — |
| Set the project up from its documents | Einrichtung (`/setup`): Projekt, Ablage, Erfassung, Rückfragen, Steckbrief | Reads the uploads, proposes each fact with its quote | Each fact |
| Guided briefing | Einrichtung (`/intake`), eight modules, answers as Wert, Schätzung or noch offen | Derives Gebäudeklasse and which OIB-Richtlinien apply | — |
| Steckbrief: address, dates, Beteiligte | Übersicht › Steckbrief › Bearbeiten (dialog) | Flags a document that contradicts it | Corrections |
| Project hub | Übersicht (`/settings`): tiles for Dokumente, Projektgedächtnis, Nutzung, Mitglieder, Steckbrief, Projektstatus, Ähnliche Projekte | — | — |
| Members and roles (Betrachter, Mitwirkender, Bearbeiter, Administrator) | Übersicht › Mitglieder (`project:members:manage`) | — | — |
| Usage and the project's budget | Übersicht › Nutzung & Budget | — | — |
| Pause, resume, close, reopen | Übersicht › Projektstatus; banner on every page | — | — |
| Close a project and keep what it taught | Projekt abschließen: Abschluss, Was bleibt, Ausmisten | Proposes decisions and lessons to keep, files to clear out | Each item |
| Similar closed projects | Übersicht › Ähnliche Projekte (up to 12) | Compares by profile, says what they decided and were told | — |

## Chat and answers

| Capability | Where | What ARCHOS does | Needs a yes |
|---|---|---|---|
| Ask about anything in the project | Chat (`/chat`) | Searches project files, Büroablage, law, web, as the question needs | — |
| Find past chats | Rail › Letzte Chats (ten newest); toolbar › Chats (panel with search) | — | — |
| Rename, share, see who reads | Chat toolbar: title, Teilen (dialog), participants | — | — |
| Temporary chat | Composer › Temporär | Remembers nothing from it | — |
| Attach files, mention colleagues, dictate | Composer: Dateien anhängen, @-Erwähnung, Diktieren | — | — |
| Run an office procedure | Composer › „/“ picks a Skill | Follows the Skill | — |
| Choose thinking depth | Composer › Aufwand (Minimal to Maximal) | — | — |
| Ask about a passage of an answer | Select text › Dazu fragen | — | — |
| Sources for every claim | Answer › Quellen, numbered markers, preview beside the chat | Cites the passage, record or measurement; marks an Einschätzung as one | — |
| See how the answer was reached | Answer › Herleitung, Denkprozess | Lists what it opened, read, measured | — |
| Find where the office handled this before | Source preview › Im Büro nachsehen | Similar passages across projects and the Büroablage | — |
| Copy, export to Word, share one answer, rate it | Answer footer | — | — |
| Rich answers | 27 card types: calculations and formulas, schematic diagrams (stairs, setbacks, egress, guardrail, daylight, fire access, sections), document grids, drafts, model cards, proposals, revision compare, page looks | Draws from parameters, never invents a figure | — |
| Diagrams and sketches | Answer › Im Projekt ablegen, Als Skizze bearbeiten | — | — |
| Remember something from the chat | Answer › „Diese Erkenntnis merken?“ | Proposes the note | Yes |

## Documents and the Ablage

| Capability | Where | What ARCHOS does | Needs a yes |
|---|---|---|---|
| Browse folders as tiles or list | Dateien (`/files`) | — | — |
| Upload files, whole folders, ZIPs | Dateien › Hochladen; drag and drop | Matches uploads to existing files and Fassungen before they land | The batch |
| Know what arrived | Upload tray; „Was angekommen ist“ per batch; Upload-Verlauf | Reads every file, says what it is and what it could not read | — |
| Screen sensitive uploads | Automatic; Organisation › Quarantäne | Holds a match before any model sees it | Release |
| Preview any file, page by page | Click a file; Prüfansicht for full screen | „Von ARCHOS gelesen“: summary, Dokumentart | Correcting the Dokumentart |
| Fassungen and Freigabe | Preview › Fassungen und Freigabe | Suggests „Ist das eine neuere Fassung von …?“ | Yes |
| Compare two Fassungen | Fassungen vergleichen (side by side, overlay, swipe), Textvergleich | — | — |
| Annotate and track open points | Anmerkungen on a page; Offene Punkte (`/files/open-points`), export as Protokoll | Can point, highlight and propose marks | Marks it proposes |
| File, move, rename | Row menu; Ablagevorschlag bar; Dateien in Ordner einsortieren | Proposes where unfiled files belong | Yes |
| Folder description and access | Folder menu › Beschreibung, Zugriff (Lesen, Bearbeiten) | Uses the description to file | — |
| Folder brief | Above a folder | Writes what the folder holds and what is missing | — |
| Search file names and content | Dateien › Suche (Enter for content); Suche (`/app/search`) across office, project, folder | — | — |
| Filter and sort | Dateien › Filter: Status, Herkunft, Freigabe, Kategorie, Dateityp | — | — |
| Restore deleted files | Papierkorb (`/files/bin`) | — | — |
| Ask about one file | File menu › Danach fragen; Mit ARCHOS besprechen | — | — |
| Download, as PDF | File menu | Logged in the Download-Protokoll | — |

## Project mail

| Capability | Where | What ARCHOS does | Needs a yes |
|---|---|---|---|
| A mail address per project | Dateien › E-Mail-Eingang › Adresse | — | — |
| File incoming mail | E-Mail-Eingang (`/files/mail`) | Proposes where each mail and attachment belongs | Yes |
| Mail threads on a document | Preview › E-Mails | Files further replies in a thread you follow | Following |
| Import an Outlook archive (.pst, .ost) | Drop it in Dateien | Turns mails into Verläufe, attachments into a folder | — |

## The building model

| Capability | Where | What ARCHOS does | Needs a yes |
|---|---|---|---|
| Open an IFC model in 3D | Dateien › model file › Im Modellbereich öffnen | — | — |
| Views, section, measure, see-through, storeys, image | The model's dock and rail | — | — |
| Element properties, isolate, hide | Click an element | „ARCHOS dazu fragen“ | — |
| Structure, Raumbuch, quantities | Details & Prüfung › Struktur, Mengen (CSV) | — | — |
| Model quality | Details & Prüfung › Überblick (Modellqualität /100) | Proposes project facts from the model | Each fact |
| Check against the OIB requirements | Details & Prüfung › Anforderungen (in a project) | Each rule: erfüllt, nicht erfüllt, nicht entscheidbar, with what the model would have to publish | Manual confirmations |
| Send open points back to ArchiCAD or Revit | Anforderungen › offene Punkte als BCF | — | — |
| Revisions and what each changed | Details & Prüfung › Revisionen, Revisionen vergleichen | Diffs elements and requirement status | — |
| Measure and query the model in chat | Chat | Measures areas, clearances, sun, envelope; reads the Raumbuch; shows model cards | — |
| Measure a DXF site plan | Chat | Parcels, setbacks, buildable area | — |

## Knowledge and law

| Capability | Where | What ARCHOS does | Needs a yes |
|---|---|---|---|
| The OIB-Richtlinien, cited at the passage | Chat; project › Wissen (`/knowledge`, gated) | — | — |
| Austrian law through RIS | Chat | Cites the official source | — |
| The office's own norms, with editions and status | Normen & Richtlinien (`/app/base-knowledge`, flag `office-standards`) | — | Confirming a norm |
| Office documents for every project | Büroablage (`/app/office-shelf`) | Searches it from every project | — |
| Put an office file into a project | Büroablage › Ins Projekt ablegen | — | — |
| Web search | Chat; office switch in Organisation | — | — |

## Memory

| Capability | Where | What ARCHOS does | Needs a yes |
|---|---|---|---|
| What ARCHOS knows about me | Mein Gedächtnis (`/app/memory`): add, edit, pin, remove | Keeps notes from my chats | — |
| What the project remembers | Übersicht › Projektgedächtnis („{n} zu prüfen“) | Records decisions, facts, open questions | Items to review |
| Standing office instructions | Organisation › Übersicht › Anweisungen (admins) | Adds them to every request | — |
| Conventions learned across projects | Organisation › „Was ARCHOS über das Büro gelernt hat“ (flag `office-conventions`) | Proposes them | Yes |

## Work handed to ARCHOS

| Capability | Where | What ARCHOS does | Needs a yes |
|---|---|---|---|
| Hand over a task, now or on a schedule | Chat; Automatisierung › Aufgaben › Neue Aufgabe (Aufgabe, Wann, Prüfen) | Runs it under the requester's permissions and budget | — |
| Standing tasks | Aufgaben › Stehende Aufgaben, weekly view „Die Woche“ | Pause, run now, edit | — |
| Review results | Aufgaben (Läuft, Ungeprüft, Fehlgeschlagen) › detail | — | — |
| Deep research | Chat, when the question needs it | Plans, researches, checks citations, files a report in „Berichte“ | The plan |
| Drafts: Aktenvermerk, Protokoll, Checkliste, report | Chat › Entwurf card › Ins Projekt ablegen | Writes it; can run calculations and produce Word, Excel, PDF where the stack turns on the code runner (`grid-oib:codeRunnerEnabled`; dev has it, prod not yet) | Filing |
| Freigabe of a written document | Fassungen und Freigabe: Zur Freigabe einreichen, Freigeben, Änderungen anfordern | ARCHOS überarbeiten lassen | Yes |
| Office procedures as Skills | Automatisierung › Skills: Neuer Skill, Empfohlene Skills | — | — |
| Assign responsibility | File › Zuweisen, Mir zuweisen | — | — |

## Working as a team

| Capability | Where | What ARCHOS does | Needs a yes |
|---|---|---|---|
| Share a chat or an answer | Chat › Teilen; answer › Antwort teilen | — | — |
| Mentions | Composer › @ | — | — |
| One inbox | Postfach (`/app/inbox`), docked beside the page on wide screens | — | — |
| Push notifications | Profil › Benachrichtigungen | — | — |
| Live presence | Documents and chats | — | — |

## The office

| Capability | Where | Who |
|---|---|---|
| Office settings: name, language, default effort, web search | Organisation › Übersicht | Admins |
| People, roles, custom roles | Organisation › Personen & Zugriff | `org:members:manage` |
| Models per agent group, zero data retention, own API key | Organisation › Modelle | `org:models:manage`, flags |
| Usage and budgets | Organisation › Nutzung & Budgets | Everyone sees their own; admins set limits |
| Storage | Organisation › Speicher | Everyone |
| Sensitive-data lists and detectors | Organisation › Sensible Daten | View all; edit `org:settings:manage` |
| Download log and its retention | Organisation › Download-Protokoll | `org:downloads:view` |
| Audit log | Organisation › Compliance (WorkOS portal) | `org:audit:view` |
| SSO, directory sync, domains, log streaming | Organisation › Enterprise | Admins |

## The person

| Capability | Where |
|---|---|
| Account, appearance, language, notifications, keyboard shortcuts, sessions, usage-analytics consent | Profil (`/app/profile`) |
| Command palette | ⌘K or Ctrl+K |
| Keyboard shortcuts | `?`; `g` then a letter jumps to a section |
| What changed | Neuerungen; „Neu diese Woche“ once a week |
| Product tour, feedback | Person's menu |

## The office's own agents

| Capability | Where | What ARCHOS does | Needs a yes |
|---|---|---|---|
| Connect Claude, Claude Code, Cursor or ChatGPT | Profil › Agent verbinden | Serves the workspace as one MCP server with the person's rights | Every write the agent proposes ([agent-surface.md](../architecture/agent-surface.md)) |

Not reachable by an agent: deciding a proposal, the office's settings, budgets,
models and screening, and the platform console
(`apps/workspace/bff/agent-api/exposure.config.ts`).

## The platform

The operator's console (`/app/platform`, platform managers only): organizations
and their limits, models, retrieval, the base corpus per country, platform
skills, lessons, feedback and quality views, storage, maintenance. Customers do
not see it.
