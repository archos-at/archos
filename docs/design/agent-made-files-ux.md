# Files the agent makes, in the chat

How a Word, Excel, PowerPoint, PDF, SVG, PNG or CSV file the agent made with
code (`execute`, [agent-code-execution.md](agent-code-execution.md)) reaches the
person who asked for it. The Markdown draft keeps its own card; this is its
sibling for real files. [design-language.md](design-language.md) wins wherever
the two disagree.

## The scene

An architect writes „Mach mir die Flächenaufstellung als Excel“. While the
agent works, the turn's status says it is calculating and making files
(`status.action.codeRun`). The answer arrives with a card that looks and acts
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
