# Files the agent makes, in the chat

How a Word, Excel, PowerPoint, PDF, SVG, PNG or CSV file the agent made with
code (`execute`, [agent-code-execution.md](agent-code-execution.md)) reaches the
person who asked for it. The Markdown draft keeps its own card; this is its
sibling for real files. [design-language.md](design-language.md) wins wherever
the two disagree.

## The scene

An architect writes „Mach mir die Flächenaufstellung als Excel“. While the
agent works, the turn's status names the file it is making („Excel-Tabelle
wird erstellt: Flächenaufstellung.xlsx …“, [In der Herleitung](#in-der-herleitung)).
The answer arrives with a card that looks and acts
like a file, not like a chat message:

- **A sheet with its first page.** The workbook's first sheet as LibreOffice
  prints it, a Word file's first page, a PDF's first page, an image as itself.
  When no page can be drawn, the sheet keeps the format's glyph and code
  (XLSX), so the card is complete either way.
- **What it is, in one look.** The file's name, then one meta line: format code,
  size, and the version once the same path was written again („XLSX · 9 kB ·
  v2“). „Entwurf in diesem Chat“ above it and „Von {productName} erstellt“
  under it: the file is labelled as an AI draft before anyone opens it.
- **Three actions.** „Öffnen“ shows every page in the document viewer the rest
  of the app uses. „Herunterladen“ gives the original file. „Ins Projekt
  ablegen“ is the one ink press.
- **After filing, the project is the truth.** The card says „Im Projekt“ and
  „Liegt als Entwurf in „Berichte““, offers „Im Projekt öffnen“ and „Zur
  Freigabe einreichen“, and then shows the review state („In Prüfung“). The
  conversation's copy steps back: no second download of bytes that are not the
  filed, AI-marked ones.
- **One card per file.** When the agent rewrites the same file in the same
  turn, the card turns to v2; it does not stack a second card.
- **Honest refusals.** A CSV cannot carry the AI marking in its bytes, so it
  cannot be filed. The card says so in one sentence and offers the way that
  works: „Als Excel anfordern“ puts the request into the composer.
- **How it was made.** An architect is liable for what leaves the office. A
  quiet „Mit Code berechnet“ under the file, opening the script and its output,
  answers „where does 92,87 m² come from“ without leaving the card.

Colour stays a verdict (design language, principle 7): the format is told by
its glyph and code, never by a Word blue or an Excel green.

## In der Herleitung

The architect asked for a file, not for a program. The status line and the
Herleitung say what is happening to *the file*, in the office's words, and
nothing in them says that code ran.

**The phases a file goes through**, as the person sees them:

| Phase | Live status line | Herleitung row, expanded |
|---|---|---|
| Preparing (the agent reads the `office-*` skill for the format; the turn before the run starts) | „Bereitet die Arbeit vor …“ (`status.action.codeRun`) | „Vorbereitet“ |
| Making a new file | „Excel-Tabelle wird erstellt: Raumbuch.xlsx …“ (`fileMake`) | „Erstellt“ |
| A retry after a failed attempt | „Excel-Tabelle wird erstellt: Raumbuch.xlsx – noch ein Versuch …“ (`fileRetry`) | the same „Wird erstellt …“, with „wird noch einmal versucht“ while it runs |
| Revising a file that was already there | „Raumbuch.xlsx wird überarbeitet …“ (`fileEdit`) | „Überarbeitet“ |
| Reading the file back to check it | „Raumbuch.xlsx wird geprüft …“ (`fileCheck`) | „Geprüft“ |
| Several files in one run | „2 Dateien werden erstellt …“ (`filesMake`) | one row per file |
| A calculation with no file | „Rechnet …“ (`calculation`) | „Berechnung · Ergebnis: Summe 92,87“, its documents under „Grundlage:“ |
| Ready | (the file card arrives) | „Liegt als Entwurf in diesem Chat“ |

Collapsed, each file is one line: „Raumbuch.xlsx erstellt · 2 Schritte“, the
steps being the phases above; the Herleitung's header adds „1 Datei erstellt“.
A press opens the phases (Radix Collapsible, a fade with a 4 px rise on
`motionQuick`, instant under reduced motion); a running phase breathes like a
running search row.

**Rules.**

- Never show code, „Skript“, „JavaScript“, isolate, sandbox, stderr or the
  tool's name. The technical record stays in the developer view
  („Zwischenschritte“, `showTechnicalReasoning`) and in Langfuse (`execute.run`).
- A failed attempt the agent retries is not an error: it is the same phase,
  still running. Only the last attempt of a settled turn decides.
- A final failure says in plain words what could not be made („Raumbuch.xlsx
  konnte nicht erstellt werden“, „Die Datei ließ sich diesmal nicht
  fertigstellen.“) and offers „Noch einmal versuchen“, which puts the request
  into the composer. The Herleitung's header carries the warning pill
  („1 Datei nicht fertig“).
- A duration shows only from 10 s.
- A calculation's result is shown only when it is short (a number, or up to
  three named numbers), written the office's way; anything longer is the
  answer's to explain. Its documents open at their first page, as a read row's
  document does.

**Where the names come from.** The `execute` tool emits one status step per
run (slot `file-run:<id>`, `tools/execute/progress.py`). At the start it reads
which `/workspace/` paths the module names (a path inside `readFile(…)` is a
read, any other a write; `/workspace/in/` is an input) and whether each is
already in the working directory, and picks the key and its `file` and
`format` values; it counts the attempt from the turn's earlier runs on the same
files. At the end the same step carries `status`, `made`, `changed`,
`elapsed_ms`, a short `result`, and the input `documents` with their
`document_ids`. The module's source and its stderr never leave the tool. The
browser groups the steps by file (`ui/features/chat/lib/file-work.ts`) and
draws them (`FileWorkList`); for a turn that only made files the graph,
which would hold nothing but the question, stays out. Examples on
`/dev/derivation-files` (`?variant=live`, `settled`, `failed`, `&open=1`).

**Deliberately later.** Filing („Im Projekt abgelegt“) as a phase of the row:
`file_draft` carries no file name on its step yet. Linking a row to its file
card in the answer.

## What this change ships

- **The file card** (`FileDraftCard`), chosen by `AnswerCards` for every
  `document_draft` card whose path is not Markdown. Thumbnail sheet, name, meta
  line, authorship, state, and the actions above; keyboard reachable (the
  thumbnail is a button named „{Name} öffnen“), screen-reader names for the
  card, the format and the page image; phone width stacks the actions full
  width. The Markdown card shares its filing state through `useDraftFiling`.
- **Preview.** `GET /api/conversations/[id]/draft/rendition?path=` answers a
  PDF: a PDF draft as it is, an Office draft converted by Gotenberg
  (`convertOfficeToPdf` in `bff/documents/rendition.ts`, the same converter and
  concurrency slots as document renditions, a 45 s budget), cached in memory per
  organization, conversation and content hash, with an ETag. The card draws page
  one with pdf.js once it scrolls into view (`useFileThumbnailState`, shared with
  the mail attachments). Images come from the download route. CSV and other text
  open in the text preview dialog as a table or plain text; HTML is never
  answered as HTML.
- **Download.** `GET /api/conversations/[id]/draft/download?path=` streams the
  bytes from the agent host's `?raw=true` with the type from the extension, an
  attachment disposition, `nosniff` and a sandboxing CSP (an SVG's script never
  runs on the app's origin), capped at 25 MB.
- **Filing.** `fileConversationDraft` reads the bytes and files them through
  `fileAgentFileDraft` (the server function of the internal `create_file` op,
  with the output check and the AI marking), in the person's session. An SVG the
  store kept as text goes the same way. CSV, JSON, HTML and other text are
  refused with `422 not-fileable` before anything is read. The answer names the
  folder (`Berichte`).
- **One card per path per turn.** `emit_draft_card` replaces the turn's earlier
  card for the same path.
- Both routes are operations (`conversation-draft-download`,
  `conversation-draft-rendition-get`), offered to outside agents.
- Examples on `/dev/document-draft-card`.

## Deliberately later

- **„Mit Code berechnet“.** The card does not know which run made the file: a
  `document_draft` card carries a path, not the `execute` call. The slice that
  closes it puts the run's id on the card and opens the script and its output
  from there. Until then the authorship line and „Entwurf“ are the label.
- **A newer version in a later turn.** A card from an earlier answer keeps
  saying v1 when a later turn writes v2; it could say „Neuere Fassung unten“.
- **Replacing a filed file.** Filing again while the filed version is still a
  draft answers the filed version, as for Markdown; it does not swap in the
  newer bytes with `update_file`.
- **Prerendered previews.** The first look at an Office file waits for
  LibreOffice (a few seconds). Converting when the file is written, and keeping
  the rendition beside the draft, would make it instant and survive restarts.
- **A CSV table in the thumbnail.** The sheet shows the glyph; the table opens
  with „Öffnen“.
