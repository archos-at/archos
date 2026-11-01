# Fits the lineup

[`VISION.md`](../../VISION.md#principles) principle 8 asks every feature to draw
on what the office already holds and to open in the places people already work.
This page is the checklist that makes the second half checkable. Answer it
before you ship a feature, and above all a new kind of document or a new
surface. The PR template's „Fits the lineup“ section names the touchpoints you
answered, and CI's **Fits the lineup** job fails a PR that leaves the section
empty.

Paths are under `apps/workspace/` unless they start with `docs/`.

## The touchpoints

A touchpoint the feature never reaches gets "n/a" and the reason. A touchpoint
it reaches answers the question with the component named, or with the ADR that
lets it differ.

| Touchpoint | The question | Owned by |
|---|---|---|
| Files list row | One row per document? Does the kind label say what it is (Skizze, Zeichnung), and do Fassung, Freigabe and the KI marking show as on every other row? | `ui/features/documents/components/file-list-view.tsx`, `ui/features/documents/document-kind.ts`, `document-kind-thumbnail.tsx`, `document-version-badge.tsx`, `document-status.tsx`, `authorship-line.tsx`; the listing in `bff/documents/document-listing.ts` |
| Files preview | Does it render in the preview well, and do the rail actions (Diskutieren, Kolleg:in fragen, Fassungen, Anmerkungen) work unchanged? Does an extra action add a second way in? | `ui/features/documents/components/file-preview-pane-document.tsx`, `file-preview-pane-details.tsx`, `file-preview-pane-footer.tsx`; extension slots in `ui/features/documents/preview-actions.tsx` |
| The document view | Does it open in the shared review, with its header (name, Fassung, „Ersetzt …“, offline), presence, Anmerkungen list, page menu, „Protokoll exportieren“ and „Piloti prüfen lassen“? | `ui/features/documents/components/review/document-review.tsx`, `review/review-panel.tsx`, `review/presence.tsx`, `review/review-export-menu.tsx`, `ui/features/documents/hooks/use-document-review.ts` |
| Deep links | Does an inbox entry, a mention or a search hit (`?doc&review=1&mark=`) land in that same view, at the mark? | `ui/features/documents/lib/open-review.ts`, `ui/features/search/lib/search-hrefs.ts` |
| Search | Is its content found by the office search, and does the hit open the document like any other? | `ui/features/search/`, the BFF search routes |
| Chat | When Piloti produces one, does it become the same document, filed once, and opened again through the same view? | `ui/features/documents/lib/open-filed-document.ts`, `ui/features/cards/components/` |
| Piloti and the agent door | Can Piloti and an outside agent read it and propose a change that a person confirms? Does the receipt show where the person works, not only in chat? | `bff/agent-api/catalog/`, `bff/agent-api/exposure.config.ts`, [`headless-first.md`](headless-first.md), [ADR-0122](../adr/0122-everything-a-person-can-do-an-agent-can-do.md) |
| Fassungen and Freigabe | Do new Fassungen, compare and the Freigabe flow apply, from the same rail? | `ui/features/documents/components/document-revisions.tsx`, `document-review-controls.tsx`, `revision-compare/use-revision-compare.tsx` |
| Sharing and restricted folders | Does it follow folder access, and does a move take every part of it along? | [ADR-0087](../adr/0087-folder-access-follows-workos-roles-and-a-restricted-folder-is-its-own-collection.md), `bff/documents/move-to-folder.ts`, `bff/sharing/registry.ts` |
| Download and export | Does download give the file a colleague outside the office expects, from the same menu? | `ui/features/documents/components/document-actions/document-actions-menu.tsx` |
| The live room | One room and one presence per document, or a second avatar row from a library? | `ui/features/realtime/`, the room on `use-document-review.ts` |
| Phone | Can it be reached and used from Files on a phone? Check `reader` branches, which hide actions there. | `ui/features/documents/components/file-preview-reader.tsx`, `files-phone-rules.spec.tsx` |

## How to tell you are building an island

Sharing the data is not enough. A feature can store its rows in the shared
tables and still be a second product in the interface. The signs:

- **Its own shell.** A dialog, header or page of its own where the shared view
  already exists.
- **Its own list.** A list, panel or count that the shared one should hold.
- **A second entry point.** A button that opens the same thing a different way,
  or a deep link that lands somewhere other than where the Files row opens.
- **A duplicate renderer.** Two rows, two presences or two previews for one
  document.

### Worked example: the Skizze

[ADR-0148](../adr/0148-a-sketch-is-a-document.md) made a Skizze a document. Its
data fits: the same documents table, Fassungen, Freigabe, Anmerkungen and room.
Its interface did not. It opened in `ui/features/diagrams/sketch/sketch-dialog.tsx`
instead of the review, so the header had no document name or Fassung, there was
no Anmerkungen list, no export and no „Piloti prüfen lassen“. A deep link to a
mark opened the dialog, not the review. Files showed two rows, the SVG and its
PDF rendition, and both carried the photo kind. Excalidraw drew its own presence beside
the review's. On a phone the editor was unreachable.

### What to do instead

Make the new kind a mode of the existing component. The review takes its
content area as a stage, and the Skizze supplies one through the slot in
`preview-actions.tsx`. Everything around the stage stays shared. When the
shared component cannot hold the new kind yet, lift it in the same change (see
"correlated substrate debt" in [`AGENTS.md`](../../AGENTS.md#two-rules-that-span-services)).
A shell of its own is the cheaper first commit and the more expensive product.
