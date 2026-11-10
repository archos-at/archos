# GRID Design Language

> Branding note (2026-07-17): the user-facing product brand — wordmark, tab titles, all UI copy — is **Piloti** (`src/lib/brand.ts`). GRID remains the internal/platform name, including this design language and its tokens (e.g. the `--law-blue` alias).

The single reference every page redesign builds against. Goal: an **understated, premium, precise** workspace for architects and planning offices, where they run projects, files, the building model, tasks and research. Linear/Vercel/Stripe-dashboard restraint, not consumer SaaS. Calm, trustworthy, dense-but-legible. No gradients, no emojis, no decorative color.

The visual language is **warm paper monochrome + provenance signal colors** (adopted from the click-dummy overhaul, see `docs/design/click-dummy-overhaul-spec.md` §1/§4): warm paper surfaces, a near-black ink ramp, hairline alpha-ink borders, layered soft shadows, **near-black action buttons** — and the *only* chroma in the app is the source/provenance signal system.

**Where it is headed.** The corporate design system 3.0 (`packages/brand/`, its README's „Design rules“) is the source this document follows, at the app's lighter level (§„Weight, face and white“). Where the two disagree, the design system wins and this document is changed in the same change: so far tracking (never tighter than 0) and the one grey (no alpha steps, nothing grey on grey). Inside the app that last rule is **superseded by [Paper on a desk](#paper-on-a-desk-2026-11-10)**: three planes, sheets with an edge and a shadow, and hairlines between list rows.

## Paper on a desk (2026-11-10)

**This section supersedes every conflicting surface rule below, including owner decision D4 (the tonal secondary press) and „one grey, nothing grey on grey“.** The owner approved it; the brand README (`packages/brand/README.md`) stays the website's rulebook, and the app keeps this layer on top of it. Rules below that it overrides carry a **Superseded** mark. Tokens: the final block of `apps/workspace/ui/styles/tokens.css`; ratchets: `apps/workspace/tests/brand-literals.spec.ts` and `bff/utils.spec.ts`. Built in Dateien (Alle Dateien, E-Mail-Eingang, Offene Punkte, Papierkorb), the file preview and the folder brief; every other screen moves when it is reworked, by the recipes below.

**Thesis.** The app is a desk, the office's documents are sheets lying on it, and ink is the only thing that speaks. Chrome recedes, sheets rise, one black action per area.

**Why.** The brand's rules are a website system: „hierarchy comes from size“ works at 44 to 96px display type, an app has 11 to 24px; „no lines, no shadows, one grey“ works for five sections a page, an app has two hundred objects a screen. Surfaces sat at 1.00 to 1.14:1 against each other, type at one weight, and the raised shadow (1px at 4%) rendered as nothing.

### The three planes

Every pixel of a screen belongs to one plane. Name the plane in the class (`bg-paper`/`bg-background`, `bg-desk`, `bg-sheet`), never „the grey“ (`bg-muted`, `bg-secondary` are banned on reworked surfaces).

| Plane | Token | Light | Dark | What it is | Lies on it |
|---|---|---|---|---|---|
| Paper | `--paper` (`bg-background`, and the body's `bg-surface-base`) | `#fafaf9` (the brand's `surface`) | `#0f0e0d` | The working page: a tab's listing, the header band | Rows with hairlines, tiles, sheets |
| Desk | `--desk` | `#f2f1f0` (the brand's `surface-sunken`) | `#1f1e1c` | What sits beside or behind the page: the rail, a list column of a split view, the stage behind a document, a choice's track, the hover | Sheets, a picked row, the track's white thumb |
| Sheet | `--sheet` + `shadow-sm` (elevation 1, its 12% edge included) | `#ffffff` | `#2c2a27` | An object: a document's page or thumbnail, a folder, a card, the open mail, an inspector group, the never-used address | Text, rows with hairlines, asides (a left rule), a desk (a stage, a rail) whose sheets are one level up again; never a sheet directly on a sheet |

**The paper and the desk are the brand's own grounds** (`packages/brand/tokens.json`: `surface` `#fafaf9`, `surface-sunken` `#f2f1f0`; the app adds steps under them, never a ground of its own). A white sheet stands 1.04:1 off the paper and 1.13:1 off the desk, so what separates it is its 12% edge and its elevation, which every sheet carries (principle 2); the desk is 1.08:1 under the paper. Two state fills sit on the ladder after the desk, one even step apart: **picked** `#e7e5e3` / `#262422` (the brand's `line` grey; a row or tile ticked for a batch, a nav pill off its track; `--selected`; 1.11:1 under the desk) and **pressed** `#dcdad7` / `#3a3734` (1.11:1 under picked). **Current and picked, when adjacent, differ by at least 1.2:1 in both themes** (the open mail's sheet over a picked run: 1.26:1 in light, 1.23:1 in dark, where the sheet is `#363330`); a picked row has no edge, only its fill. **Current** (the one you are looking at: the open mail, the open tab) is white on the desk, **picked** the selected grey. **A fill is one step down the ladder from the plane it lies on**: a track, a hover or a well is the desk on paper or on a sheet, and the selected grey on the desk (the E-Mail-Eingang's Wartet/Bearbeitet track vanished on its desk column until it took `@3xl:bg-selected`). **Dark is derived, not mirrored: nearness is lightness.** Paper is the darkest plane, the desk one step lighter (as macOS's sidebar sits lighter than its content), a picked row one step lighter again, and the sheet above both: the open mail's row is the lightest thing in its list column (round 2 drew picked rows lighter than the open one, so „nearness“ ranked them above it). A darker desk was 1.03:1 under its paper and the list column vanished. **In dark only a sheet or a thumb is lighter than the plane it lies on**: a press is its plane's own fill with the 16% edge (transparent), a white wash one step up under the pointer; a chip is the desk's fill; a pin is a small sheet. Overlays stack on top: a menu or floating bar is a sheet at elevation 2 (radius 16; in dark its edge at 14% and a lit top edge, as a shadow is invisible on charcoal), a dialog a sheet at elevation 3 over a 40% ink scrim.

### Its principles

| # | Principle | Do | Do not |
|---|---|---|---|
| 1 | Three planes | Paper for the page, desk beside and behind it, sheets for objects (the table above) | A grey box on paper or on a sheet and call it a surface |
| 2 | A sheet has an edge and a shadow | Every document, thumbnail, folder, card: `bg-sheet shadow-sm`, elevation 1 with its 12% edge, on paper and desk alike; a sheet without both is a bug | A shadow on buttons in a row of ten; a shadow without the edge; a sheet directly on a sheet |
| 3 | Rank by two channels | Each heading level differs from the next by 1.2x size or a weight step, plus spacing | Same size and weight for a heading and its rows |
| 4 | White with an edge means you can touch it; its shape says what happens | **Press**: 32px, radius 6, the 12% edge and no shadow at rest, its 1px shadow under the pointer (`variant="secondary"`, `shadow-press`). **Thumb**: white with that shadow, only inside a desk track; the current choice. **Sheet**: radius 10, elevation 1; an object that opens (a folder says so with its chevron). **Chip** (Offene Punkte's filters): radius full, 28px, the desk's fill and no edge; picked, the selected grey and a tick; „Alle“ is a chip, picked while no other is. A chip never has the press's shape. **Current** is white on the desk, **picked** the selected grey, **ink** the one primary of an area, **desk grey** the hover | One look for two of these (round 2: a folder, „Ordner anlegen“, the open tab and the view toggle's thumb were one white rounded box); a thumb off a track; a fill laid over the kit's press |
| 5 | Lines for lists, space for sections | One inset hairline between rows (the rule below); 32px between sections, except a brief's folded line, 16px above the listing it describes | Boxes inside boxes; rules between page sections; a hairline of a list's own |
| 6 | Actions appear where the hand is | A row shows its action at rest only when rows differ in what they offer (a group's „Ablegen“, „Ansehen“). Where every row offers the same action it is a ghost glyph at rest and the labelled press on hover, focus and selection (the Papierkorb's restore), a 44px glyph on a coarse pointer; a row's menu is ⋯ on hover, focus and selection (always on a coarse pointer, `ROW_REVEAL`), on files and folders alike | A column of identical buttons |
| 7 | Colour is a verdict | Ochre needs you, red failed or destroys, green done, always with glyph and word; a dot counts as the glyph only in a legend that keys a bar (the brief's meter) | A hue for decoration, a format, a rank or a person (the photo placeholder's gold PNG chip went; Offene Punkte's markers in the author's hue went; Dateien's avatars are neutral, `tone="neutral"`) |
| 8 | Dense by default, calm by alignment | Row 40 for one line, 56 for a name and one meta line; tiles of sheet + name + one meta line, the list above 50 documents, one left edge, tabular numerals | A third line at desk width, except a row's reason for needing the reader (the mail list's „Anhang prüfen“); explanatory subtitles in permanent chrome; a description on every tile |

**One primary per area.** An area is a pane: the list column, the reader, the preview's rail, a dialog, the page header. Each holds at most one ink press. A floating batch bar replaces its pane's primary while it is shown, and while it is up the reader's primary steps back to the raised press (`DecisionBar yieldPrimary`), so the screen never shows two ink presses for two different batches; the reader's „Verwerfen“ steps out too, so „Verwerfen“ is on screen once.

### Hard numbers

- **Type** (General Sans, size/line/weight): 11/16/500 codes only (a format: PDF, DWG); 12/16/440 meta (`text-meta`); **12/16/500 muted label** (`SectionLabel`, the card eyebrow: a column head, a group label over a list such as „Dateien“, a field label such as „E-Mail-Text“); 13/20/500 names and controls (`text-name`); 14/20/440 body; 16/24/600 section (`text-section`: a group heading, the preview's file name, an empty state's headline); 20/28/600 pane title (`text-pane-title`: the open mail's subject); 24/32/600 page title (`text-page-title`, the `PageHeader`); **mono 13/20/440** a string to copy (the project's mail address). Every row's name is `text-name`, the mail list's subject included (it was 14px). Weights 440, 500 and 600 only; 600 is for headings and for state (a mail or point that needs the reader), 500 for one that waits on a press, 440 for one that is handled; 700 stays the wordmark's. `cn()` knows these sizes (`TYPE_SCALE` in `bff/utils.ts`): before, tailwind-merge read `text-name` as a colour and dropped it beside `text-foreground`.
- **Spacing**: 4, 8, 12, 16, 24, 32, 48. Row 40 for one line, 56 for a name and one meta line (10px around 20 + 16; the Papierkorb, the mail list, Offene Punkte), compact 32 not built. Control 32 (touch 44). **On a phone a row is 56, or 72 with two meta lines; a meta line breaks only at a separator and never ends a line with one** (the Papierkorb's two fixed lines: what it holds, then what stays and who deleted it; Offene Punkte's one line: what, where, who has it, by when).
- **Radius**: 6 control (and the old 4px inline step), 10 sheet and card, 16 overlay and floating bar (and the old 18px bubble), full for pills. There is no `--radius`.
- **Neutrals**: the table above. **Lines**: hairline `rgb(15 14 13 / 0.08)` (`--hairline`; dark `rgb(245 244 242 / 0.1)`), edge `rgb(15 14 13 / 0.12)` (`--edge`; dark 0.16), field border `#8a8784` (`--field-border`; dark `#77736e`): a field is white with it, never a desk well (Alle Dateien's search).
- **The press** (`--elevation-press`, `shadow-press`): `0 0 0 1px var(--edge)`; under the pointer `--elevation-xs` (`shadow-xs`), the edge and `0 1px 2px rgb(15 14 13 / .06)`, which is also the thumb's at rest. **Elevation 1** (sheet, `--elevation-1`, `shadow-sm`): `0 0 0 1px var(--edge), 0 1px 2px rgb(15 14 13 / .06), 0 2px 6px rgb(15 14 13 / .04)`. **Elevation 2** (menu, floating bar, a document's page on its stage, `shadow-md`): `0 0 0 1px rgb(15 14 13 / .08), 0 4px 12px rgb(15 14 13 / .10), 0 12px 32px rgb(15 14 13 / .08)`; dark adds the 14% edge and an `inset 0 1px 0` lit top. **Elevation 3** (dialog only, `shadow-lg`): `0 0 0 1px rgb(15 14 13 / .10), 0 24px 64px rgb(15 14 13 / .22)` over a 40% ink scrim.
- **Colour roles**: action = ink; picked = selected grey; hover = desk grey; status = ochre, red, green; provenance hues unchanged; a person is no colour in Dateien.
- **Contrast**: text 4.5:1; control boundary 3:1; **two neighbouring planes on the ladder (paper → desk → selected → pressed) step at least 1.07:1 in both themes** (light: 1.08, 1.11, 1.11), a sheet always carries its edge, and paper to sheet is at least the brand's 1.04:1 (the paper is never white). Changed from the critique's 1.15:1: its own light neutrals step 1.08 and read apart in every capture, so 1.15 was a rule its numbers broke; dark meets 1.15. Held by „the neutral ladder“ in `brand-literals.spec.ts`.

### Recipes for the next screen

- **Page header** (`PageHeader` with `crumb`, as `ProjectSectionFrame` builds Dateien): a 12/16 muted crumb of where the place is („Projekt › Dateien“), the place itself as the 24/32/600 title („E-Mail-Eingang“, not „Dateien“ over the inbox), the places as tabs on a desk track under it, the page's tools on the title's line and the level's tools on the tabs' line. **No standing subtitle**: a place's list says what it holds. The tabs stand 24px under the title block (16px on a phone), so they read as the title's places and not as its last line. On a phone the page starts with its title at 16/24/600, with no crumb: the way back starts the title's line and the app's search ends it (the rail's rules, „No project name stands above a phone page“), the tabs name only the open place (the others are their glyph, `SectionNav compactOnPhone`), and a page whose tools fold into one ⋯ puts it on the title's line (`ProjectSectionActions onTitleLine`: the E-Mail-Eingang's address, Offene Punkte's Protokoll); Alle Dateien's search keeps its row.
- **Inside a folder** (Alle Dateien below its root, 2026-11-10): **the title names where the reader is**, the folder („Index C“, at the page title's size, wrapping onto a second line rather than cutting a long name); „Alle Dateien“ is the title only at the shelf's root, and its tab stays current, because the tab names the place and the title the level in it. **The crumb carries the way there** after the project: „Projekt › Dateien › Abgabepläne › … › Index C“, the open folder never a step of its own crumb, each step a way up and a drop target, cut at 16rem with its whole name as its title; past two levels the middle folds into one „…“ that opens a menu of the hidden levels (`trailSteps`, `folder-trail.tsx`, through `ProjectSectionPlace`). The level's tools („Auswählen“, „Ordner anlegen“) stand on the tabs' line as at the root, a phone's in its ⋯, so the pane draws **no path row**: the row under the tabs said the way back twice („← Zurück zu Alle Dateien   Alle Dateien › Berichte“), its labels wrapped and its long names were cut without their text. On a phone the title's line starts with the ← one level up. The brief under it says how far it reaches („in diesem Ordner“, „… und seinen Unterordnern“), never the name the title already gives. A folder's description, where it has one, is the first line under the tabs; „Beschreiben …“ is in the folder's ⋯ one level up. Held by `folder-trail.spec.tsx`.
- **List row**: 40px for one line, 56 for a name and one meta line, the hover the desk, a leading column (checkbox, avatar, format, glyph, marker) hanging left of the text. **One inset rule** (`ROW_HAIRLINE` in `ui/components/ui/row-hairline.ts`): the line runs from the row's first text to the list's text end. The list sets two numbers, `--row-text` (row edge to first text) and `--row-end` (its right padding), and nothing else; the last row has none, and a row with a fill of its own (`data-filled`: the open row's sheet, a picked or selected row) has none on either side. A table row takes `TABLE_ROW_HAIRLINE` (`--row-lead`, `data-row-text`, `data-row-skip`; a pseudo-element on a `<tr>` became a table column). A row wrapped by a context menu takes the menu's `asChild`, so it stays its list's (or its table's) own child and `last:` still finds the last one. A list row's summary sits on the name's line in muted 12px, in what is left of it, or is its one meta line („14 Dokumente · gelöscht von … am … · bleibt bis …“). Its action stands on the column's right edge (principle 6: shown at rest only where rows differ in what they offer), or in that slot one muted line saying why there is none. A page-wide list keeps its text to a measure (the Papierkorb's 880px, Offene Punkte's 720px) and stands what is scanned down the page (who has a point, by when) in a column on the right edge. **Tables**: the column head is the table's first row, above the folders; a folder is a row of the file table (`folderRows`, `FolderRow` in `folder-table-row.tsx`) with the file rows' 40px and columns, its count in the Größe column; numbers right-align to their head, dates left-align; a chip in a name line is 20px. On a phone the lone „Name“ head goes and every row has its ⋯.
- **Tile**: a sheet (the document's first page or kind sketch, 124px, white even when there is no picture: the glyph says what failed), what is open and in progress on the sheet's foot, then the name (13/20/500, two lines at most, cut in the middle) and one meta line right under it, format · size · age. No description; the chat's card without a meta line keeps the summary as its second line. **No upload tile among the files**: a dashed „Dateien hierher ziehen“ cell stood in the grid as a file that was not one; the header's Hochladen is the one upload, the whole page takes a drop, and the foot of Hochladen's menu says so with the formats and the limit. A folder is a sheet 56px tall (glyph, name, what it holds, a chevron at its end; its ⋯ comes in left of the chevron) inside the same 6px hover inset; on a phone a 48px sheet in the grid's two columns (glyph, name, count; its menu a long press away), and the phone's Hochladen a 56px round glyph. At the root „Ordner“ heads the folders as „Dateien“ heads the files. A level of more than 50 documents opens as the list (`fileViewFor`), unless the reader chose.
- **Split view** (the E-Mail-Eingang): two whole objects on the title's edges, 16px apart and 24px off the foot so both show their corners: the list on the desk (its rows 8px inside), the reader a sheet. **The reader is never empty at desk width**: arriving with nothing open replaces the URL with the first mail (`useOpenFirstMail`, from a 48rem split; never on a phone, where opening hides the list). The open row is a sheet on the desk, 4px apart from a run of picked rows (three fills fused into one block), picked rows the selected grey, and a selection's bar floats as a sheet at elevation 2. **The reader's foot** is pinned to the sheet's foot (24px off it, the content scrolling under it, a faint shadow while it does): the muted sentence of what one press files on the left („In E-Mail-Verlauf „Stellplatznachweis“ ablegen (wird Fassung 4)“, the press's accessible description), shown only once the choice it repeats has scrolled out of view, then „Verwerfen“ and the primary „Ablegen“. A thread's group line is 40px with its press centred and 8px under it, so the press never touches the open row's sheet. The „Wartet“ notice keeps to 64ch.
- **Inside a sheet** (the reader, a dialog): no grey boxes and no second shadow. A list keeps its hairlines and bleeds by its row inset; an aside (the header's details, a calendar invitation, what can still be restored) is set off by a 2px edge rule and 12px of indent, as a quote (`QuietPanel`); a disclosure is muted 12px with its chevron turning („Ganze E-Mail anzeigen ⌄“). The pinned action foot takes the sheet's own white. A sheet may hold a desk (the preview's stage and rail); the sheets on that desk are one level up again (the page at elevation 2, the rail's groups at 1).
- **Inspector** (the preview's rail): the rail is the stage's desk continued, no line between, and the desk runs under both columns so the rail's scroll fade dissolves into it (it showed the dialog's white); each group is a sheet (`InspectorGroup`) with hairlines between its rows; the one primary and the raised secondary stand on the desk. The dialog's title is the file name at 16/24/600 with its meta 12 under it; a summary in the rail is body, 14/20/440; „{productName} hält es für“ and the type share a line, the type 13/500.
- **A brief over a listing** (`FolderBrief`): folded, one muted line with its glyph on the column's edge; open, a sheet whose edge stands on the column's edge and whose content is 16px in, on a phone inside the 16px gutters with its full edge and radius. **What it found sits with what it read**: at the project's root the findings from the documents (`DocumentFindingsSection`) are a section of the brief's sheet after what needs the reader, a heading by weight over one row per finding (its glyph and sentence in ink, the documents it rests on in the 12px meta line), and the folded line counts them in ink after what it read („Alle 28 Dokumente gelesen in diesem Projekt · 1 Befund“); the upload report's link (`#document-findings`) opens the brief. They were a bordered box across the whole page above the brief (dev, 2026-11-10): two strips about one subject, the first off the column. A finding is a pointer to check, so it takes no hue (principle 7). Held in `folder-brief.spec.tsx` („what it found“).
- **An empty state's object** (the never-used address) is a sheet on the paper; in a dialog the dialog is the sheet. The empty state's glyph sits on a small sheet too (`EmptyStateDisc`), never a grey tile. Its headline is `text-section`; with an object under it, the glyph, the words and the object stand on the column's left edge (never centred in the pane at an edge of their own).

### What round 6 changed in the concept, and why

Built against the first real project on dev (2026-11-10), which the previews had not drawn: five folders and two loose files at the root, a finding from the documents, and the levels a person walks into. `/dev/files-page?project=real` now draws them (`?folder=`, `?folders=many`, `?picking=1`, `?brief=open`, `?q=`, `?upload=1`).

1. **Inside a folder the title is the folder** and the crumb the way there; the pane's path row went (the recipe „Inside a folder“).
2. **The findings are a section of the root's brief**, counted on its folded line, not a bordered strip across the page.
3. **No upload tile in the grid**; Hochladen's menu says where else files may go.
4. **Nothing is cut without its whole text in reach**: a crumb's step carries its title, a folder's name wraps before any cut as a file's does (`FileName wrap`; one line cut „Besprechungsprotokolle“ to „B…chungsprotokolle“), the selection's count never shrinks (on a phone the move press keeps its glyph instead), the brief's line wraps, a label never wraps inside a press („Zurück zu / Index C“ did), a finger's 44px ⋯ has a 44px cell (it ran 8px past a phone's table, which then scrolled sideways), and a sheet's edge is never under a band with a fill (the sticky path row painted the page's paper over the findings box's lower edge). `bun run clip-check` walks the states at 1700, 1440, 1024, 768 and 390px and finds each of these.
5. **The upload tray is a sheet on the column** (`UPLOAD_TRAY_SHEET`), its rows 16px in; it was a band from the rail to the screen's edge with a rule under it.
6. **A narrow section keeps its places whole** (a tablet or a small laptop beside the 272px rail): below a 60rem section the header's tools stand under the title instead of three rows beside it, and the level's presses („Auswählen“, „Ordner anlegen“) keep their glyph with their name as title; below 44rem the places name only the open one, as on a phone. At 1024px „Offene Punkte“ was cut and „Papierkorb“ gone under the presses.
7. **An empty folder's glyph, words and Hochladen stand on the column's left edge**, not centred in the pane, and no longer send the reader to a sidebar that is not there.
8. **The tile's meta line joins who has it and its facts with the dot** („Unvergeben · PDF · 240 kB · vor 7 Tagen“); without it „Unvergeben PNG“ read as one phrase. Whether „Unvergeben“ belongs on every tile at all (a fine state that speaks, against „a status that is fine says nothing“) is open.

### What round 5 changed in the concept, and why

1. **The light ground is the brand's again** (2026-11-10, a pilot office's colleague: the background had drifted away from the new corporate design, „Das helle finde ich passender.“; the founder agreed). Round 3 had darkened the paper to `#f6f5f3` and the desk to `#edece9` so a white tile would stand off the page by its plane; the page no longer looked like the brand. The paper is the brand's `surface` `#fafaf9`, the desk its `surface-sunken` `#f2f1f0`, picked `#e7e5e3` and pressed `#dcdad7` one even step under the desk each (1.11:1), and the browser's chrome follows. A sheet now separates by its 12% edge and its elevation, which round 3 had already put on every sheet. Dark is unchanged. Held by „the light paper and desk are the brand's surface and sunken surface“ in `brand-literals.spec.ts` and the brand check in `app/manifest.spec.ts`.
2. **Dateien's places have air under the title**: the tabs sat 12px under the title block (8px on a phone) and read as part of it. They stand 24px under it (16px on a phone): the title, then its places. Held in `brand-literals.spec.ts` („the places stand clear of the title“).

### What round 4 changed in the concept, and why

1. **Principle 6 no longer contradicts the list-row recipe**: „one visible action per row“ produced the column of identical presses it forbade (the Papierkorb's five „Wiederherstellen“). A row shows its action at rest only where rows differ in what they offer; the same action on every row is a ghost glyph until the hand is there.
2. **A chip has its own shape** (it was the press at rest, and „Für Sie“ read as a command): a 28px desk pill, no edge, and „Alle“ as the state of no filter.
3. **Dark has a press rule and a floor between states**: a press is its plane's fill with the edge (round 3 drew it as the sheet, so a press, a folder and a chip were one box), and current over picked is at least 1.2:1 (the dark sheet went from `#2c2a27`, 1.08:1, to `#363330`); Offene Punkte's pins are small sheets, not fixed white discs.
4. **Phone rows and tables are ruled** (56 or 72; a meta line breaks only between clauses; the table's head above its folders, numbers right, dates left), and so are two type gaps (mono 13/20/440 for a string to copy, `text-section` for an empty state's headline).
5. **„32px between sections“ has its one exception**: a brief's folded line is 16px above the listing it describes.

### What round 3 changed in the concept, and why

1. **Press, thumb and sheet have three shapes** (principle 4 said „raised white = press“ and „white thumb = choice“ and „sheet = object“, which were one look): the press lost its resting shadow, the folder became a 56px sheet with a chevron, the thumb kept the shadow and its track. Held by „press, thumb and sheet“.
2. **The paper is `#f6f5f3`, one step under the brand's surface**, and every sheet carries the 12% edge (was 8% on elevation 1): the commonest pair, a white tile on paper, was 1.04:1 and the contrast floor skipped it. The ladder moved with it (desk `#edece9`, selected `#e4e2df`, pressed `#d9d6d2`) and the browser's chrome follows the paper.
3. **Dark: the sheet is above a picked row** (`#2c2a27` over `#262422`): picked rows were lighter than the open one.
4. **Colour is a verdict, ratcheted where it slipped**: Offene Punkte's markers are ink, ochre only for a point assigned to the reader or overdue (who set it is the name in its meta line; the review keeps the author's hue beside the page, where it matches the pin on the sheet); a mention of the reader in a mark wins by weight on the desk, not by ochre; the preview's avatar and the fixture's slate bars lost their hues; the brief's red dot became a glyph.
5. **One primary per area is defined**: a pane is an area, and a floating batch bar takes its pane's primary while shown.
6. **A sheet may hold a desk; a sheet directly on a sheet is what is banned** (the preview is a sheet holding a stage of sheets, which the old wording forbade).
7. **Rows have two heights, 40 and 56**, and a third line only for a reason the reader is needed (row 40 was the rule while two- and three-line rows shipped). The label step 12/16/500 is in the scale.
8. **Principle 2 no longer names popovers and floating bars**: they are elevation 2, not 1.

Round 2 changed: the dark desk lighter than paper (measured 1.03:1); the floor 1.07:1 per ladder step (was 1.15); one inset rule as a mechanism (`ROW_HAIRLINE`); the tile's meta line right under the name; the rail as desk with sheet groups; asides as a rule, not a box; planes named in classes.

**Not yet done.** Offene Punkte may move out of Dateien later (to the Übersicht, or a place of its own): a pilot office found it does not quite belong among the files, and it stays there for now; compact density (32px rows); the rest of the app (chat, settings, the review canvas) still carries the previous rules; the review rail's mark rows still wrap their meta line; mails carry no read state, so the mail list's weight says „needs you / waits / handled“ rather than „unread“.

## Principles

1. **Restraint is the aesthetic.** Warm paper surfaces (`#f6f6f4`-family, warm charcoal in dark mode), a near-black ink ramp, and **no brand accent color on actions**: the primary action is ink (`#1f2023`, white text; paper-white on ink in dark mode). If everything is highlighted, nothing is. Blue is *not* the action color — it belongs to the Baurecht provenance signal.
2. **Provenance is (almost) the only color.** The one place chroma exists BY MEANING is the source signal system (`--source-law` blue, `--source-project` green, `--source-office` gold, `--source-auto` gray, `--signal-error` red). It runs through composer, citations, history filters, and insights — it is the product's trust affordance. **Color never travels alone: every signal is always icon + label + color together** (a11y and legibility). Green doubles as status "Aktiv"; red is for errors only. There is no general accent: `--accent-pop` was carved out for one in 2026-08 and withdrawn in 2026-09 (§"Accent pop" below has the reasoning, and it is worth reading before proposing another one).
3. **Authority through precision.** Piloti cites its sources: the laws and norms among them, and the office's own files. Each claim resolves to a passage a person can open, so citations, legal basis and document provenance must look verifiable and exact on every surface: monospace for identifiers, clear source attribution, never decorative.
4. **Hierarchy over density.** Dense is fine (architects handle complex data), but every screen has ONE clear focal point and a legible reading order. Whitespace does the separating, not boxes-within-boxes.
5. **Motion with a reason.** Movement here is an argument, not an ornament: it says where something came from, that a press landed, or that a change took. Entrance fades with a slight rise for arriving content; smooth height only for a block arriving or folding at or below the reading point (see Motion vocabulary → Height); skeleton→content. **Springs are allowed where the motion's trajectory carries information the endpoint does not** — a panel arriving from an edge, a toggle thumb clicking into its detent, a dropped file landing, a row gliding to its new group. They are physics, not personality: the overshoot budget is **1–2 pixels of visible travel**, so the spring is chosen by distance, never by taste. Everything else — colour, opacity, hover, system-initiated entrance — is a tween, 120–240ms. Never a spring on colour, on legal content, on errors, or on anything repeating more than about five times per screen. Respect `prefers-reduced-motion` absolutely: motion must be droppable with no loss of information.
6. **Every state is designed.** Loading, empty, error, partial, success. Empty states especially are craft opportunities, not afterthoughts — they orient and invite the next action.
7. **Figma is an inspiration, never a template.** When a surface is a tool (search, a register, a panel, a property sheet), it can help to ask how Figma would approach it: a calm canvas, quiet sections, a command field with its shortcut, keyboard first. Take the spirit, not the look: nothing is copied from it, and this document decides every concrete choice (colour, type, spacing, atoms).
8. **Nielsen's ten usability heuristics are a must**, not a taste: visibility of system status; match with the real world (the office's own words: Plannummer, Index, Planstand, Maßstab); user control and freedom (undo, clear, back keeps state); consistency and standards; error prevention; recognition rather than recall; flexibility and efficiency of use; aesthetic and minimalist design; help users recognise, diagnose and recover from errors; help and documentation. A new or reworked surface goes through them one by one, and its PR states for each what the surface does about it, next to its screenshots ([Nielsen Norman Group, "10 Usability Heuristics"](https://www.nngroup.com/articles/ten-usability-heuristics/)).
9. **Question every explanation.** Explanatory copy is welcome where it adds what the surface cannot show (what a search reaches, why a result matched, what a file will hold). Each one first answers why it is needed: when it compensates for an unclear control, change the control, and the sentence may then shrink or go. When it carries real information, keep it short and concrete, in the office's words.

## Tokens (already defined in src/styles/tokens.css)

Use shadcn semantic classes: `bg-background/card/muted/accent`, `text-foreground/muted-foreground`, `border`, `bg-primary/text-primary-foreground` (primary = **ink**, near-black), `bg-destructive`, `ring-ring`. Feedback subtle backgrounds via the `--background-color-feedback-*-subtle` vars (already wired into Badge/Alert success/warning/info/destructive variants — these now resolve to the provenance tints). Never hardcode hex/oklch in components.

**Surfaces (light):** app bg `--background` ≈ #f6f6f4 warm paper · sidebar/rails `--background-color-surface-sunken` ≈ #f1f1ef · cards `--card` = the brand's raised surface `--ds-surface-raised` (#fafaf9, never pure white; a card is told from the paper by its hairline and faint shadow) · input surface `--input-background` = `--ds-surface` · chip/quiet fill `--secondary`/`--muted` = `--ds-surface-sunken` (#f2f1f0) · inset/hover `--accent` ≈ #ececea. Dark mode is the derived warm-charcoal equivalent (same warm hues, no cold blue-grays).

**Surfaces (dark):** sidebar/rails #100f0d · app bg `--background` #171613 · input well `--input-background` #1c1b18 · cards `--card` #22211d · popovers #2a2825 · chip/quiet fill #2e2c28 · inset/hover `--accent` #373531.

### Dark mode is derived, not mirrored

Dark builds depth **differently on purpose**, and this is the one place the two
themes are not the same system with swapped values. Copying light's ratios into
dark is what made the first pass read as mud, so before re-tuning any dark
surface, know why it is shaped this way:

- **Elevation is carried by lightness, not by shadow.** On paper a raised card (`--ds-surface-raised`, the paper tone itself)
  separates from the background mostly through its drop shadow — dark-on-light,
  high contrast — and the surface step itself only does ~0.03L of work. On
  charcoal that shadow contributes nothing (black on near-black is invisible),
  so the step has to carry the hierarchy alone. Dark therefore uses **wider
  steps** (bg→card is ~0.048L) and steps again for every plane above it.
- **Raised planes get a lit top edge.** `--elevation-sm/md/lg` in dark open with
  an `inset 0 1px 0` paper highlight: light comes from above, so a raised
  surface catches it on its top edge. This is what actually reads as "raised" in
  a dark UI, and it works where a drop shadow cannot. `--elevation-xs` stays
  shadow-only — on a chip or button that highlight reads as a seam.
- **Shadows anchor rather than lift.** They are deeper and tighter than light's,
  and their job is separating a floating plane from what it covers (dialogs,
  popovers), not creating the elevation itself.
- **Inputs are recessed, cards are raised.** `--input-background` sits one step
  *below* `--card`: a field is cut into its surface, not floated off it.
- **Surface direction is preserved from light:** sunken < background < card <
  popover < chip < hover.

Two failure modes this replaced, worth recognising if they reappear: a token
defined as a `color-mix()` of an **already transparent** token (that is how
`--input-background` became ~4% paper alpha and every field in dark mode went
invisible), and a scrim built from `--background` at near-full opacity (which
erased the page behind a modal instead of dimming it, so the dialog lost any
sense of sitting *on* something).

**The first paint is already in the theme.** The theme is a client-only fact
(a stored choice, or the OS), so the server renders without `.dark`. An inline
script in `<head>` (`app/theme-boot.ts`) sets it before the first paint, and
`providers.tsx` keeps it in step afterwards; applied from a React effect, a
dark load painted about 700 ms of light paper first. `color-scheme` follows
the theme (`light` on `:root`, `dark` on `.dark`), so scrollbars, form
controls and the overscroll canvas match it.

**Increased contrast is two steps harder, nothing else.** Under
`prefers-contrast: more` secondary text (`--muted-foreground`,
`--text-color-subtle`) takes the next ink step up, the placeholder takes the
old muted step, and every hairline (`--border`, `--input`,
`--border-color-base`) roughly triples. The hierarchy stays; it is only drawn
harder. Both themes are restated in full inside the query, `.dark` second,
because `:root` and `.dark` have equal specificity there. Decorative overlays
that paint the card's colour over content (the streaming caret's veil) are
hidden under `contrast-more:` and `forced-colors:`.

**Ink ramp (light):** #1f2023 (foreground/action) → #55565a secondary → #6f706c muted → #8a8a86 placeholder → #b3b3af ghost. Borders are **alpha ink hairlines** (`rgba(28,30,33,…)` equivalents at .08 base / .12 input / .16 strong / .22–.32 selected), so they composite on any surface. Focus ring is ink-based (`--ring`), never blue, and it is for the keyboard: the global `:focus-visible` outline is unlayered on purpose, so it survives every control's `outline-none` and gives the keyboard its 3:1 indicator on top of the softer `FOCUS_RING` halo (in a cascade layer, `outline-none` once dropped it app-wide); an overlay's panel never draws one when it takes the focus itself on open. **A field's focus is its border, nothing more.** A text field (`Input`, `Textarea`, `Select`, every search bar, the chat composer) shows `:focus-visible` on a mouse click, so a halo or the global outline on it is drawn on every click: three bands where the reader wanted a caret (Notion #38). `FIELD_FOCUS_RING` / `FIELD_FOCUS_WITHIN_RING` (`components/ui/focus-ring.ts`) turn the 1px border to `--ring` and switch the global outline off (`outline-hidden!`, which forced colours still draw); that border is above 3:1 against paper and against the resting border in both themes. Buttons keep `FOCUS_RING`. **A focus ring snaps.** No transition list in a control names `box-shadow` (a Tailwind ring is a box-shadow) or, on a field, `border-color` (a field's focus is its border turning to `--ring`): a ring that fades in is a ring that is not there yet when the reader looks for it.

**Provenance signal system** — each signal has a base color, a `-tint` surface (for chips/rows on cards), and a `-text` variant (AA-readable on the tint), both modes:

| Token family | Light base | Meaning | Paired icon |
|---|---|---|---|
| `--source-law(-tint/-text)` | blue #2359d3 | Rechtsquellen (RIS, BO Wien, Behörde) | "§" |
| `--source-oib(-tint/-text)` | indigo | **Accent inside law** — OIB-Richtlinien & Erläuterungen | "§" (same as law) |
| `--source-project(-tint/-text)` | green #17914d | Projektwissen (project documents) | doc |
| `--source-office(-tint/-text)` | gold #c08c28 | Büroablage (Office filing) | archive box |
| `--source-auto(-tint/-text)` | gray #83837f | Automatisch / **Lücke** (knowledge gap) | globe / gap |
| `--status-active(-tint)` | = project green | status "Aktiv" | dot |
| `--status-done(-tint)` | warm gray | status "Abgeschlossen" | dot |
| `--signal-error(-tint)` | red #c14a38 | errors only | alert |

All are mapped as Tailwind colors (`bg-source-law-tint`, `text-source-law-text`, `border-source-office`, `bg-status-active-tint`, …). **Rule: color never travels alone — a provenance color always appears together with its icon and a text label.** Never use a source color decoratively or for anything but its meaning. `--law-blue` survives only as a legacy alias of the law blue; it is not an accent.

**Accents vs. signals.** `--source-oib` is the one *accent*: a hue inside an
existing signal, not a fifth family. OIB stays `law` everywhere the coarse
stratum is what matters (icon, composer presets, trust grouping, `SourceKind`) —
the accent exists only because OIB and RIS are the two tiers architects compare
most, and a Herleitung fan-out painting both the same blue left the authority
badge carrying that whole distinction alone. Resolve it with `accentForLane`
(`lib/source-kinds.ts`), never by hand, so the Herleitung cards and
the "Belegt durch" chips cannot drift. The type is `SourceTint = SourceSignal |
'oib'`; an accent always keeps its stratum's icon.

**Accent pop — tried, and withdrawn (2026-08-27 to 2026-09-01).** There was
one carved-out general accent: `--accent-pop`, a moss/lime green (hue ~126)
taken from the marketing site's chat mock, deliberately a different hue from
`--source-project`'s forest green (hue ~152) so the two would not be read as
the same signal. It marked a moment as live/ready rather than stating a fact,
and it lived on the composer — the focus ring while typing, the send button
once a message was armed.

It is gone, and the tokens with it. Two reasons, in the order they matter:

1. **It contradicted Principle 1**, which this document opens with: no brand
   accent color on actions, the primary action is ink. The exception was
   written knowing that, and the composer is precisely where the rule earns
   its keep — the send button IS the primary action.
2. **A different hue is not a different signal to a reader.** The composer's
   ring is on screen for the entire time somebody is composing, directly above
   an answer whose provenance chips are green. Two greens a few degrees of hue
   apart, one meaning "project source" and one meaning nothing at all, is not a
   distinction anyone makes at a glance — and the one carrying no icon and no
   label is the one that cannot explain itself. Reported as such by the product
   stakeholder, who asked for the grey/black it had been.

The lesson is the one the section already tried to state and could not enforce:
a control that wants to stand out wants contrast, not chroma. The armed send
button reads as armed because it goes from muted to solid and becomes
pressable — the colour was carrying a distinction the contrast had already
made. **Do not reintroduce a general accent token.** If a future surface needs
"live/ready", say it with contrast, weight or motion.

## Type ramp (Tailwind classes — use verbatim)

The ramp targets the dummy's 9.5–24px scale: **20px page titles**, **23px hero greeting** (the one larger moment, chat empty state only), and the **12px eyebrow/label convention** (sentence case, medium weight, muted ink; it was 10.5px until 2026-11, when the Dateien review found every section label reading as fine print beside 13px names, below the 11–12pt floor Apple's HIG sets for a label). Nothing but the wordmark is set in capitals: a label in capitals shouts, and the wide tracking it needs to stay legible reads as a rendering fault once the label is in sentence case. Acronyms, file-format codes (PDF, DWG) and keycaps keep their own spelling. **Tracking is never tighter than 0** (the design system 3.0, `packages/brand/README.md`, „Typography“): only the wordmark sets tighter. The ramp's `tracking-tight` on every title was the previous design language's and went app-wide on 2026-11-06; `tests/brand-literals.spec.ts` („tracking“) fails a new one. The few files that may set `uppercase` (the wordmark, format chips, authority tags, initials) are listed in `apps/workspace/tests/brand-literals.spec.ts`; a new one needs an entry there with its reason.

| Role | Classes |
|---|---|
| Hero greeting (chat empty state only, ≈23px) | `text-[23px] font-medium` |
| Page title (≈20px) | `text-xl font-medium` |
| Section heading | `text-lg font-medium` |
| Card/subsection title | `text-sm font-medium` |
| Eyebrow / label (sentence case, 12px) | `text-xs font-medium text-muted-foreground`, written once as `.card-eyebrow` and reached through `SectionLabel`; no `uppercase`, no tracking; `TableHead` takes it too (existing `text-xs` eyebrows are acceptable until a screen is restyled) |
| Answer text (16px) | `text-answer` (`--text-answer`, `ui/styles/tokens.css`): the ONE size of an answer's text: prose, lede, standfirst, a block's body, a card's body and title (`.card-body` and `.card-title` read the token). Headings, figures and the caption/meta/eyebrow steps keep their own; a size step inside an answer that expresses no rank is the defect it removed (Notion #38) |
| Body | `text-sm` (leading-relaxed for prose) |
| Body secondary | `text-sm text-muted-foreground` |
| Caption / meta | `text-xs text-muted-foreground` |
| Identifiers (job id, § refs, collection names) | `font-mono text-xs` |
| Numeric stat | `text-2xl font-medium tabular-nums` |

### Weight, face and white (the app's brand level)

The app wears the corporate design with a lighter hand than the website
(owner decision D3: soft radius ladder, faint shadows and lucide icons are the
app's own choices, not defects). Inside that level the rules are the brand's:

- **Superseded by Paper on a desk (600 is allowed for headings and state).** **Content weight is 500.** Emphasis is size and ink, never 600 or 700: a
  title is `font-medium` at a larger size or in `text-foreground`, its
  context in `text-muted-foreground`. Secondary running text is the
  light end, `font-normal`, which is **440, not 400**: General Sans is
  variable and its 400 read thin on paper and charcoal alike (Notion #38).
  `--font-weight-normal` in `tokens.css` sets it once, `body` reads it, and
  nothing is set lighter (`tests/brand-literals.spec.ts`). The card scale in `globals.css` (`.card-title`,
  `.card-headline`, `.card-figure-*`) is 500 as well; its caption and body
  steps read `--font-weight-normal`.
- **One documented exception to 600:** numerals and initials set at 12px or
  smaller inside a badge, marker, count or avatar (a citation marker, a count
  pill, a stepper numeral, a collaborator's initials), where 500 loses against
  its fill. The files are listed in `tests/brand-literals.spec.ts`; a new one
  needs an entry there with this reason.
- **The wordmark** is the product's name (`PRODUCT_NAME`) in capitals, Switzer
  Semibold, tracked -0.02em, drawn only by `Logo` (`kind="wordmark"`, the default). It never
  stands beside a mark: where the word does not fit (the collapsed icon rail),
  `kind="icon"` draws the app icon's glyph, the name's initial, alone. Its face is the `@font-face` in
  `app/globals.css` (`--font-logo`), which the browser fetches only when the
  wordmark is on screen. The PDF exports set it in the same face
  (`bff/pdf/fonts.ts`).
- **Body face** is General Sans (`--font-sans`). **Geist Mono** is the app's
  monospace for code, keycaps, identifiers and the skill editor
  (`--font-mono`); the brand has no mono, and the app keeps one on purpose.
  Its 0 is plain, never slashed: a slashed 0 in a count read as a crossed-out
  zero. The face's own stylistic set (`ss09`) does it, switched on once with
  the family (`--font-mono--font-feature-settings` in `tokens.css`), which is
  why the font comes from the `geist` package and not Google Fonts, whose copy
  has no plain 0 ([gotcha](../contributing/gotchas.md)).
- **The brand has no colour of its own.** It is black and white: warm white `--ds-surface` (#fafaf9), black `--ds-ink` (#0f0e0d) and one light grey `--ds-surface-sunken` (#f2f1f0). The app's hues (provenance signals, status, the data palette, the energy scale) are functional and documented exceptions; add no new one.
- **Superseded by Paper on a desk (the secondary is raised white).** **The secondary press is tonal (owner decision D4, 2026-11-06).** The design system makes it an outline; the owner asked for fewer outlines, so the app's `secondary` button is the one grey on white and white on a grey panel (`data-surface="sunken"` on the panel; the variant reads it). One primary per area stays. Dateien and the E-Mail-Eingang set no `outline` button, held by `tests/brand-literals.spec.ts` („the secondary press“); the rest of the app moves when it is reworked. Which press takes which look, and why bare words are not a press: [A press looks pressable](#a-press-looks-pressable-and-a-choice-sits-on-its-track-2026-11-10).
- **Colour carries meaning, never decoration (owner, 2026-11-10).** One grey and ink are the frame, not a ban on colour: a hue stands where it tells a person something they act on. Ochre (`--warning`) for what needs a person (an overdue point, „Anhang prüfen“, an open point's marker), on the glyph, the words in ink where they must be read (§„Warning gold is a glyph colour“); red (`--destructive`) for a failure and for the press that destroys (its glyph in a row, the whole press in the confirm where it happens); green (`--status-active`) only for a confirmed done state; a count or marker that says „this needs you“ (the filter's `CountPill tone="attention"`). Never to decorate, never to rank ordinary presses, and never as the only signal: the word or the glyph stays beside it (WCAG 1.4.1). Only the brand's tokens (`packages/brand`, `ui/styles/tokens.css`), no new hex.
- **Superseded by Paper on a desk (five neutrals, grey on a white sheet).** **One grey, and nothing grey on grey.** A fill is the one grey (`bg-muted`, `--ds-surface-sunken`) or, for a state (hover, the open row, the selected tile), `bg-accent`; never a step of either (`bg-muted/60`). Inside a grey panel what sits on it is white (`bg-background`): a chip, a thumbnail, a secondary press, as the design system keeps a band's content white. Dateien and the E-Mail-Eingang are held to it by `tests/brand-literals.spec.ts` („one grey“); the rest of the app is not yet.
- **No pure white.** Surfaces are `--ds-surface` (paper), `--ds-surface-raised`
  (`--card`, `--popover`, overlays) and `--ds-surface-sunken`. Pure white stays
  only where something is a document's own paper (the PDF viewer page, a
  review pointer's ring on a page, a diagram export, text on a collaborator's
  fixed-hue cursor) and on printed PDFs (`bff/pdf/theme.ts`: a laser prints
  white, not a warm wash). `tests/brand-literals.spec.ts` lists them.
- **Data colours** (charts, meters, the timetable) are typed once, in
  `ui/styles/data-palette.css`, with the validator notes; a chart reads
  `--chart-series-N` / `--spend-series-N`. Diagram colours are read off the
  tokens (`diagram-palette.ts`). Nothing else carries a data hex.
- **PDF exports:** ink, paper and greys are the brand neutrals (`theme.spec.ts` holds them to
  `apps/workspace/shared/brand/tokens.vars.css`); the wordmark is Switzer Semibold; the body
  stays Helvetica because the brand ships General Sans only as a variable
  WOFF2, which react-pdf embeds as blank glyphs. A static General Sans Medium
  TTF or OTF from `packages/brand` is the one thing that unlocks it.

### Accessibility gate (WCAG 2.2 AA, light and dark)

`task workspace:a11y` runs axe-core with the WCAG 2.0, 2.1 and 2.2 A and AA rule
sets over every `/dev` preview route (`scripts/a11y-audit.mjs` finds them on disk, so a
new preview is covered without an edit; the older routes still in `scripts/a11y-pending-routes.json` wait for their first audit), light and dark, at 1440 and 390 pixels. It
starts its own `next dev`; it is not in CI yet (see `docs/contributing/ci.md`), so run it before a UI change lands. It fails on any violation not in
`scripts/a11y-baseline.json` and on a baseline entry that is gone, so the list only
shrinks. `ui/components/brand/brand-surfaces.a11y.spec.tsx` holds the structural
rules in the unit suite (jsdom cannot measure contrast). Contrast rules for what
you write: text is 4.5:1 and large text 3:1; secondary text is
`text-muted-foreground` at full strength, never `/60` to `/90` of it; text on a
tint takes the `-text` token (`--source-*-text`, `--status-active-text`), never the
signal colour itself. Disabled controls are exempt, as WCAG 1.4.3 says
("inactive user interface components"); axe skips them. A scrollable region must be
reachable by keyboard (`tabIndex={0}`).

**Answer prose** (`MarkdownRenderer`). Paragraphs and lists hold a
`max-w-[72ch]` measure. The body hyphenates (`hyphens-auto`, words of ten
letters or more, four on each side, `[hyphenate-limit-chars:10_4_4]`) by the
document's `lang`: German compounds („Brandabschnittsfläche") left a ragged
edge and, in a narrow table column, a line of their own. Section headings are
`hyphens-manual`; they read as one phrase. **No `text-wrap: pretty` on prose
that can stream:** Chromium re-breaks the lines above the last as words are
appended, so lines the reader has already read jitter. A heading may balance
only if it arrives whole.

## Spacing & layout rhythm

- **Page container:** `mx-auto w-full max-w-5xl px-4 py-8 md:px-8` (content pages). Chat/full-bleed surfaces are exceptions.
- **Vertical section gap:** `space-y-8` between major sections; `space-y-4` within a section; `gap-3` in tight lists.
- **Card padding:** `p-6` for feature cards, `p-5` for stat cards, `px-4 py-3` for list rows.
- **Radius ladder:** the app's own ladder from the brand package (`tokens.json` radius tokens with `"scope": "app"`, as `--ds-radius-*` in `apps/workspace/shared/brand/tokens.vars.css`; the website never receives them). Small inline things take `rounded-inline` (4px — kbd, checkbox, a tag inside a field); controls `rounded-control` (6px — buttons, fields, selects, tabs, menu and list items); surfaces `rounded-surface` (10px — cards, panels, list containers, toasts, tables, code blocks); floating layers `rounded-overlay` (14px — dialogs, popovers, menus, sheets, the command palette); chat messages and the composer `rounded-bubble` (18px); `rounded-full` only for what is round (chips, badges, counts, avatars, dots, switches). Tailwind's `rounded-sm/md/lg/xl` are mapped onto the same four steps for code not yet on a semantic name. The names differ from the website's `radius-md` (4px, controls) on purpose, so no name means two sizes. Radius is paint: a radius-only change moves no layout box.
- **Glyph sizes:** the glyph sits two steps below its well — `size-3.5` in badges/chips, `size-4` free-floating UI glyphs (pagination chevrons, dialog close, `size-9` wells), `size-3.5` in `size-7` wells, `size-5` in the empty-state/confirm discs. A new well picks the glyph its size already owns; it does not invent one.
- **Borders:** hairline `border` (border-border — alpha ink, composites on any surface). Prefer a single border + `bg-card` over nested boxes. Use `divide-y` for list groups inside one bordered container (the previous language's habit: a reworked surface draws neither, see [Surface rules](#surface-rules-dateien-and-the-e-mail-eingang-2026-11)). Depth = surface step + layered soft shadow (`shadow-xs/sm/md/lg` are bound to `--elevation-*`, and a bare `shadow` is the `sm` step rather than Tailwind's cold black default), never a heavy border.

## Surface rules (Dateien and the E-Mail-Eingang, 2026-11)

What took Dateien and the E-Mail-Eingang from a 5 to a 10 over the 2026-11 review rounds. Apply them to the next surface you rework; each names its reason, and what a machine holds says so (`tests/brand-literals.spec.ts` unless named).

### A press looks pressable, and a choice sits on its track (2026-11-10)

The rounds before scored „reduction“ and had no line for affordance, so 93 presses on Dateien ended up bare words and the segmented controls lost their track: „Als Fassung 4–6 ablegen“, „Auswählen“, „Filter“ and „Mehr zur Adresse“ read as labels, and an unchosen „Bearbeitet“ as plain text beside a filled word. A person must tell at a glance what is pressable and what is a choice, without outlines, lines or a second grey.

- **Primary: filled ink, one per area** (Hochladen, Ablegen, the decision bar's filing press).
- **Superseded (raised white, see Paper on a desk).** **Secondary: tonal, for every press that does something** (D4: the one grey on white, white on a grey panel): it creates, files, selects, filters, opens a menu of actions, restores, deletes. „Auswählen“, „Ordner anlegen“, „Filter“, „Mehr zur Adresse“, a thread's „Als Fassung … ablegen“ and „Ansehen“, Offene Punkte's „Prüfansicht öffnen“, the brief's „Anzeigen“, the Papierkorb's two presses, the preview's „Herunterladen“, its ⋯ and „Ändern“, „Korrigieren“ in the reading. A row-end press of a heading or a thread line is tonal too, its 32px overhanging the 24px line.
- **Bare words or a bare glyph only where the press is not the thing:** navigation (a crumb, a back arrow, a tab), a disclosure (aria-expanded: „Vollständige Zusammenfassung“, „Zitierten Text zeigen“), a row in a menu, and an icon-only tool whose row is the target or which belongs to the window (a tile's ⋯ on its frosted disc, a notice's ×, the preview's enlarge and close). Each worded ghost left on these surfaces names its reason in `WORD_GHOSTS_ALLOWED` (`tests/brand-literals.spec.ts`, „a press looks pressable“); a new one fails there.
- **A choice sits on its track.** A segmented control (the E-Mail-Eingang's filter, the grid/list toggle, the filter menu's sort and Zuständig; Offene Punkte's filters are chips since round 3 of Paper on a desk) is a track of the one grey with the chosen item on a white thumb, Apple's segmented control; an unchosen item hovers to ink, not to a fill. There is no trackless form (`ToggleGroup` lost `bare`): every single choice on these surfaces is `segmented` (held: „a choice sits on its track“).
- **One meaning per look: white on the grey track is chosen, the grey alone is a press.** Dateien's tabs sit on a track too (`SectionNav track`): the open tab a white thumb, the others ink on the grey, 28px on a 32px track. As a text tab bar with the open tab filled grey (the first try), the reviewer read the open tab as one more press and „Auswählen“ and „Ordner anlegen“ beside it as a second group of tabs, and grey meant „chosen“ in the tabs and „not chosen“ on the filter below them.
- **Rhythm:** presses 12px apart (`gap-3`), the last one's fill on the content edge (no negative margin: a tonal fill is not given back); tonal presses are 32px (`size="sm"`), 44px under a coarse pointer; a segmented track is the control height of its row (the grid/list track holds 28px squares, `size="icon-sm"`, so it is Hochladen's 32px).

**Surface and colour**

- **Superseded (see Paper on a desk).** **One grey, nothing grey on grey.** A fill is `bg-muted` or, for a state, `bg-accent`; never a step (`/60`). What lies on a grey surface is white: a chip, a count, a secondary press, an avatar disc (held: „one grey“).
- **Hover is the one grey, the open or picked item the state grey.** A tile, a list row, a folder row and a mail row hover `bg-muted` and hold `bg-accent` when open or picked; a thumbnail sheet on that fill takes the fill (`bg-transparent`), or it is grey on grey.
- **A box earns its grey.** Folders are a glyph and a name on the page, not grey tiles: they read apart from files by shape (a line, not a sheet), and three grey blocks over a grid of grey sheets was the page's loudest thing. Thumbnails keep the grey: the design system lays cut-outs on `surface-sunken`.
- **Superseded (raised white).** **The secondary press is tonal** (D4): grey on white, white on a grey panel (`data-surface="sunken"`), never an outline (held: „the secondary press“), and every press that does something is one (above).
- **No section lines** (still true for page sections; lists now take an inset hairline, see Paper on a desk). No rule above or below a block, no hairlines between rows, no dashed box, no bordered card around a bar: white space and the one grey separate. A bar pinned over the content it sits in takes `shadow-pinned-foot` (`globals.css`), drawn only while content lies beneath it; a split view's pane divider is a function and stays (held: „no section lines“).
- **Superseded (a floating white bar at elevation 2).** **A mode is a band.** A selection bar under a list is a band of the one grey across its column, its content on the listing's edges, the secondary (white on it) before the primary at the end, in Dateien and the E-Mail-Eingang alike: one row where the column has the room (Dateien), the count above the presses in the E-Mail-Eingang's 26rem list.
- **A bar follows what it decides on.** On a desk the decision bar sits under the mail's content and pins only once the content overflows; on a phone it stays at the foot, under the thumb.
- **An unchecked control draws the field border** (`--ds-line-strong`, 3.4:1): the alpha `--input` measured under WCAG 1.4.11's 3:1 (`checkbox.tsx`, `radio-group.tsx`).
- **The header copies, the dialog shows.** The E-Mail-Eingang's header has „Adresse kopieren“ (the tonal secondary) and „Mehr zur Adresse“; the 45-character address is read in that dialog and in the never-used empty state. Whole in monospace it was the loudest thing in the header, cut in the middle it lost whose it was.
- **The agent's disc claims a suggestion.** The filled `AgentGlyph` stands only where the agent proposes something (a filing target); what the agent read is the brief's and the preview's one glyph, sparkles (held: „the agent's disc“).
- **A member wears their identity colour, a stranger the neutral disc.** The preview's assignee avatar takes the member's fixed hue (`avatar-identity.ts`, the same as their cursor); a mail sender, who is no member, is the one grey, white on a grey row.
- **Quiet is the normal case.** All read, nothing open, nothing waiting says nothing or one muted line; ochre is for what needs a person (an overdue point, a mail to check), red for a failure, each with its glyph and word (colour carries meaning, never decoration). A destructive press in a row is tonal like its neighbours with its glyph in red, the word in ink (five red words „Endgültig löschen“ led the Papierkorb, and the same press all in ink read as the same weight as „Wiederherstellen“); the confirm's press is the red one, where the act happens and what cannot be undone is said. An open point's marker keeps its hue: in Offene Punkte every marker means „open“, and it is the same pin, in the same author's hue, as on the page.

**Edges and rhythm**

- **One left and one right edge per tab container.** A listing is the design system's 1280px container with 32px margins (16px on a phone), its header included (`SECTION_HEADER_CLASS`), and so is every Dateien tab (Offene Punkte, Papierkorb, and the E-Mail-Eingang's split view: never a column or a width of its own), so the title and the tabs stand still when the tab changes; a full-width split moved them 80px. Every element's content stands on those edges. The container is `listing-container` (`globals.css`, held: „one ramp, one scale“).
- **Centre the container only where nothing stands beside it.** It keeps the section's left edge (beside the app rail, the rail's edge) and centres once the section is 1440px wide or more, by a container query on the section frame (`@container/section`): the page cannot ask whether a rail is shown, and a 1440px section has none beside it on a laptop and is a wide screen otherwise, where 192px of paper on one side read as a page that had slid.
- **On a phone a grey panel spans the screen** rather than bleed into the 16px gutter (the open brief, the mail's groups, the address panel: `-mx-4`, square, 16px inside); 12px of bleed left it 4px from the glass. A pill does not bleed on a phone (the tabs, the segmented filter start on the 16px gutter): 4px from the glass is cramped, and a band is not a pill.
- **Content on the edge, state fills bleed.** An inset that only holds a hover fill is given back as a negative margin: the file grid by the tile's 6px (`-mx-1.5`), the list by its cells' 8px (`md:-mx-2`), and the brief by 12px, so the first glyph stands on the title's edge. A fill that is always drawn is the edge itself and is not given back: a tonal press ends on the content edge with its fill, under Hochladen's, and a track (the tabs', a segmented control's) starts on it. Inside a tile the name sits on the thumbnail's edge, no inset of its own (held: „one left edge“).
- **Equal gaps between like sections, 24px or so on the 4px scale:** tabs → brief → folders → label each about 24px of visible white; a label sits 12px over what it heads, nearer to it than to what precedes it. Tiles are 24px apart (a 12px gap and their two 6px insets).
- **A level's tools end the row that names the level.** At Dateien's root the tab names it, so „Auswählen“ and „Ordner anlegen“ stand at the end of the tabs row (`ProjectSectionTabActions`); inside a folder they end the path row; on a phone they are the ⋯'s first entries (iOS Files' order). A row that holds only two presses is a row too many.
- **A phone's tools sit under the tabs**, never above them: the tabs stay put from tab to tab (`project-section-frame.tsx`). A tab with many tools folds them into the ⋯ of that row (Alle Dateien); a tab with one or two keeps them visible there, in the desk's look (the E-Mail-Eingang's tonal „Adresse kopieren“ and „Mehr zur Adresse“, Offene Punkte's „Protokoll exportieren“): a press that turns ghost on a phone is a second look for one press.

**Type and words**

- **A name is one size wherever it stands:** 13px medium in a tile, a file row and a folder row. **One size per band:** the tabs row's tools take the tabs' 14px.
- **A count is the muted pill** (`CountPill`), never brackets: „Bereit 3“, as the tabs write it; on a grey surface the pill is white.
- **A level outranks what it holds:** a section heading of a list is 13px in ink, a group inside it (a mail thread) 12px muted, and a group ends 24px before the next row.
- **A card has three styles at most.** The preview's reading card: the summary at 14px, the type at 14px medium, everything else the 12px muted meta (facts, label, disciplines, topics); seven styles in one card read as unranked.
- **A sender is a name and an address, told apart by tone:** the name in ink, the address muted beside it, no ‹ › around it; the line under it (trust, arrival, „Details“) is joined by the one separator, not by 12px gaps.
- **A label is muted, its value ink.** The brief's „Worum es hier geht“ and „Wo es hakt“ are 12px muted; what they hold is ink, since that is what is read.
- **One separator.** A line's clauses are joined by `CLAUSE_JOIN` (`bff/format.ts`): a middot bound to the clause before it by a no-break space, so a wrap never starts a line with „·“; a middot set as a flex item stands 4px from each neighbour (`gap-1`), the bound join's width. On a phone a clause that would wrap („bleibt bis …“) takes its own line with no dot. A clause that says zero is dropped („6 Dokumente“, not „6 Dokumente · 0 Ordner“) (held: „one separator“).
- **Controls in a bar are 12px apart, fill to fill:** „Filter“, the grid/list track, the search field and Hochladen; „Auswählen“ and „Ordner anlegen“ at the end of the tabs row; „Adresse kopieren“ and „Mehr zur Adresse“; a pair of presses (Kopieren and Als Kontakt sichern, Besprechen and Kolleg:in fragen), each `gap-3` with no padding given back. A back press gives back its padding (`-ml-3.5`): the arrow stands on the gutter. The grid/list track is 32px (28px squares, `size="icon-sm"`, on its 2px), the search field's height. A row's text line is 20px (`leading-5`), so a chip adds no height.
- **One type ramp, one scale.** Text is 11px (codes, counts), 12px (meta, labels), 13px (names), 14px (body, headings in a list), 16px (fields on a phone) and 18px (a mail's subject); line heights are the named steps (`leading-snug` for names, `-normal` for meta); radii by their ladder names; a press is the kit's `size="sm"` (32px, 44px under touch), never a 28px override; presses in a bar are 12px apart (held: „one ramp, one scale“).
- **One absolute date form.** A date that matters reads in the locale's medium form („06.11.2026“, with the time where it matters: a mail's arrival); recency in a list reads relative, written out („vor 3 Stunden“, „vor 1 Monat“: months and years in numbers, never „letzten Monat“ beside „vor 4 Monaten“). A due date is the same form (`formatCalendarDay`), not „8. Nov. 2026“ beside „06.10.2026“.
- **A missing press says why.** Where a row's action is not offered (a folder the reader may only read in the Papierkorb), a muted line in its place says so (`restoreBlocked`); a hole where the press was is a question nobody answers.
- **A count on its way holds its width** as a skeleton pill, so the tabs after it do not jump when it lands.
- **One press per act.** Where a section is one thread and nothing else, only the thread's press files it; two presses 40px apart for the same mails was a choice with no difference.
- **Rows touch.** Rows of a list sit without a gap, so two picked rows read as one region, not two boxes with a sliver; where two picked rows meet their corners are square, so the seam shows no notch.
- **An empty state is one column**: its words and its panel share one width (512px) and one left edge, the words 24px above the panel, not a centred paragraph over a left-aligned card. An empty state without a panel stays centred. An empty detail pane is one muted 14px line under a muted glyph; while mails are picked it says what the bar does, not the count the bar already shows.
- **A label names what it heads:** the root's files are „Dateien“; „Zuletzt hochgeladen“ promised a subset.
- **What is in progress or open stands in one place.** In the list „Wird gelesen“ and „4 offen“ follow the file's name; on a tile both sit on the sheet's foot, „4 offen“ above „Wird gelesen“. A Status column held one and not the other, and a chip line under the summary left the row's other tiles a 50px hole. Sorting by status stays in the filter menu. Chips on a sheet or in a row are one size: 20px, 11px.
- **A search hit marks why.** The query's words stand in ink at 500 inside the muted passage, and for a long compound its stem too („Fluchtweg“ answers „Fluchtwegbreite“); the rank is shown only while another column orders the rows, since sorted by relevance the order is the rank.
- **A code is a word, not a disc:** the list writes a file's format as the tile's meta does (11px, muted, its own 32px column, where a folder row has its bare glyph); 8.5px in a 24px disc was below any legible size.
- **Names keep their end.** A file name wraps (`FileName wrap`) or is cut in the middle, never at its end: the revision and the drawing number are the end.
- **A clause drops whole, never cut.** Below 640px the comment chip shows „4 offen · 2 für Sie“ and drops „3 Vorschläge“; the accessible name says the whole sentence. A line that may wrap wraps whole (`text-pretty`), and a phrase that must stay together is bound in the copy with no-break spaces („wiederherstellbar bis 13.11.2026“).
- **A chevron follows its words**, not the far edge of its row: the brief's line ends in its chevron.

**Structure**

- **A tile row shares one meta baseline.** The footer fills the cell and sets its lines at its foot (`content-end`), so the size and age line is every tile's last line, whichever tile carries a second name line or „4 offen“ (`file-card.test.tsx`).
- **Columns appear only when a row fills them** (`listColumns` in `file-list-columns.ts`): an empty Status column is a promise of nothing.
- **One look for one of these.** The tabs and a segmented control beside them are both a track with a white thumb, and a worded one is set at the tabs' 14px (`[&>button]:text-sm`) (held: „a choice sits on its track“, „one size for a segmented control“). Until 2026-11-10 both were trackless (`bare`), the chosen one the one grey, and the unchosen options read as plain text.
- **A label stands 12px from what it labels.** A filter's label (Offene Punkte's „Zuständig“, „Frist“) sits 12px before its choices and the groups 32px apart; a fixed label column only on a phone, where the groups stack. A heading over rows (a document in Offene Punkte, a thread in the E-Mail-Eingang) is a line as tall as its tonal press, 32px (44px under touch), with less white above it than below the rows, so it stands nearer its first row; a 24px line with the press overhanging it put the press's 44px fill against the first row on a phone.
- **A folder row in the table's columns.** In the list view what a folder holds stands under Größe and when it changed (or was made) under Hinzugefügt, at the columns' widths (`@container/filelist` on the folder group), and the row has no chevron, as a file row has none (held: „a folder row in the table's columns“).
- **One primary per surface:** Hochladen in Dateien, the decision bar's filing press in an opened mail. **While items are picked the bar owns the action:** the section's and the thread's own presses step back.
- **One shape for one pick:** a square checkbox in the list, the E-Mail-Eingang and on a tile (`rounded-inline`), never a circle on one of them. Where rows can be picked the boxes are drawn on every row, not on hover: a hidden box left a column that read as an indent. A picked row or tile holds the state grey, as the open one does.
- **A column only where something can be in it:** the E-Mail-Eingang's handled list has no checkbox column, as an empty 28px gutter read as an indent.
- **Like things, like words:** a folder's count reads „2 Elemente“ in a tile and in a row; a chip beside a near-namesake wears its own glyph (the folder's folder, the Dokumentart's tag).
- **A placeholder is the thing's own shell.** A skeleton uses the real tile, row or pane geometry and draws no row the loaded page does not have; every empty state is `variant="bare"`, never the kit's dashed grey panel (held: „one ramp, one scale“).
- **A section opens 48px under what precedes it, a group ends 24px before the next row;** a section after a group takes the group's 24px into its 48, so the two never add up. Heading rows keep one height with their press or without: a section heading 32px, a thread's line a fixed 32px (`h-8`, 44px under touch, its press's height), so ticking a box, which steps the press back, moves no row.
- **The open tab shows whole.** On a phone the tabs row scrolls the nearest way that shows the open tab, not to its centre (both ends then showed fragments); the row starts on its first tab otherwise.
- **A missing press says why, in its place.** The reason stands where the press would (right-aligned in the press column on a desk, left on a phone with the delete on the same row), not in the meta.
- **Say a thing once per view.** The preview's header carries no type chip and no format box: the rail's reading says what the document is, the facts line under the name says „PDF“, and the name stands on the rail's 16px edge (held: „said once per view“). The never-used empty state does not repeat the subtitle's „warten hier“. A thumbnail that cannot be drawn is its 16px glyph alone; the tile's name says what the file is.
- **Copy names one cause.** „Wartet auf Ihre Ablage, weil der Absender in diesem Projekt nicht ablegen darf“, not „nicht freigegeben“ (Freigabe's word, CONTEXT.md) under „Domain bestätigt“; an expired part is „ohne Entscheidung abgelaufen“, so that it can still be restored reads as no contradiction.
- **Every hover reveal has a finger path** (`pointer-coarse:opacity-100`, `mobile-files.spec.ts`): the tile's ⋯ stays visible under touch.

### Reviewing a reworked surface

The rounds that took Dateien from a 5 to a 10 scored each screenshot set on these lines, 0 to 10, by a reviewer who sees only the screenshots. Use the same lines for the next surface; a rubric without a line for something optimises it away (the affordance line was added on 2026-11-10, after „reduction“ alone had turned 93 presses into bare words).

1. Visual hierarchy
2. Whitespace and rhythm (the 4px scale, equal gaps between like sections, one edge)
3. Reduction and cleanliness
4. Consistency
5. Nielsen's ten heuristics
6. Laws of UX (Fitts, Hick, Jakob, Miller, proximity, similarity, common region, Von Restorff, Tesler)
7. Fidelity to the design system 3.0 at the app's level
8. **Affordance:** can a person point to every pressable thing and every choice without hovering, and does nothing that is not pressable look so? Ask the reviewer per screen: „point to every pressable thing and every choice; what did you miss or misread?“, and fix what they misread.

## Touch

Sized on ONE axis — `pointer-coarse:`, never a viewport breakpoint. `md:` asks
about width, and width is a proxy for input device that is wrong at both ends: a
touch tablet past the breakpoint keeps mouse-sized controls, and a half-width
desktop window gets finger-sized ones.

**The floor is 44px on both axes**, and a control reaches it in one of two ways.
Which one is not a matter of taste — it is decided by what is next to the control:

- **Room around it → `touch-target`.** The utility centres a `max(100%, 44px)`
  catchment on the element and lets it overhang, so the drawn control does not
  move and the surface keeps its rhythm. Right for a caption-sized disclosure
  under a card's body, a lone link at the end of a turn.
- **A neighbour beside it → grow it** (`pointer-coarse:py-*`, `min-h-11`,
  `size-11`). Two 44px catchments on rows 33px apart overlap, and in the overlap
  the later element in the DOM takes the tap — the reader presses one row and
  opens the one below it. A confidently wrong target is worse than a small one.

Exceptions, and they are narrow: an inline target inside a sentence (a citation
marker, a mention pill, a prose link) cannot reach 44px without stealing its
neighbour's taps, which is why WCAG 2.5.8 exempts it. Those still grow to at
least the line box they sit in.

**A hover reveal needs a second way in.** `opacity-0 group-hover:opacity-100`
is an affordance a touch device cannot generate, so the control is present,
focusable and permanently invisible. Add `pointer-coarse:opacity-100`. The
mobile-first inversion `md:opacity-0` is only half an escape: a touch tablet is
past `md` and has no hover either, so it carries `pointer-coarse:opacity-100`
too.

**A tooltip is a label for a pointer.** It never opens under a finger (a tap on
a control is a press, not a question), so it may only say what a mouse user
also gets another way: an icon-only control's name, a shortcut, the full text of
a truncated name. Anything the reader needs on a phone is visible text. Where
the information is the whole point of the trigger (an info glyph beside a term,
a chart column whose value is the answer, why a control is unavailable), use
`Toggletip` (`components/ui/tooltip.tsx`): the same bubble, opened and closed by
a tap. Never on a control that does something; there the tap stays the action.

**Nothing takes the page scroll.** A `touch-action` that refuses the vertical pan
strands every finger that lands on it, and the browser intersects that value
across the whole ancestor chain — so a library stylesheet can freeze a region
none of our code mentions. Only a surface that genuinely owns its gestures (the
3D model canvas) may keep one.

**A control's label is not selectable.** `Button` carries `select-none` and
`-webkit-touch-callout: none`: a long press on a phone selected the label or
offered to share a link-button, where a native control does neither. Content
(an address, an error message, an answer) stays selectable; only controls opt
out.

**Text fields are 16px on a coarse pointer** (`text-sm pointer-coarse:text-base`),
or iOS Safari zooms the page on focus and does not zoom back out. On the pointer
axis and never a breakpoint — `text-base md:text-sm` looks like a floor and is
not one, since a touch tablet past `md` drops to 14px and zooms as a phone would. **The action key is labelled**: `enterKeyHint` says what
Enter does, and a field that matches strings turns off autocapitalize and
autocorrect so the phone cannot edit a query on its way into a matcher.

**Heights are `dvh` or `svh`, never `vh`.** On iOS Safari `vh` is the large
viewport, measured with the toolbars collapsed, so `85vh` is taller than 85% of
what shows and a footer lands under the toolbar. `dvh` follows the toolbars;
`svh` is the stable small viewport, for a cap that must not move mid-scroll.

**Full-bleed surfaces pad the edges they touch.** `viewport-fit=cover` hands
the insets to each surface: a sheet's top runs under the status bar, its bottom
under the home indicator, and on a phone on its side the Dynamic Island sits on
one long edge, about 59px deep. Pad with `max(<the padding>,
env(safe-area-inset-*))` on the sides the surface touches, so the plain padding
holds wherever there is no inset. The paper still bleeds to the glass; only the
content steps in. A caller that replaces a primitive's padding (`p-0`) owns its
insets too.

Held statically by `apps/workspace/ui/components/ui/touch-target.spec.ts`,
`apps/workspace/ui/components/ui/mobile-affordances.spec.ts` and
`apps/workspace/ui/components/ui/breakpoints.spec.ts`. The browser
measurement that once backed these (`task workspace:touch-audit`) went with the
screenshot harness; capture a 390x844 viewport and look, until it is rewritten
(`docs/contributing/testing-and-verification.md`).

## Breakpoints: four axes, four questions

A layout decision picks the axis whose question it is asking. Width is a proxy
for most of these, and a proxy is wrong somewhere.

| Axis | Spelled | Answers | Decides |
|---|---|---|---|
| Input | `pointer-coarse:` / `pointer-fine:` | What is driving the pointer? | Touch size (44px floor), 16px fields, whether a hover can reveal anything |
| Phone | `phone:` (below `sm`, or a phone on its side) | Is this a phone-sized screen? | Overlay presentation: the Dialog's bottom sheet, its stacked footer |
| Layout | `md:` / `max-md:`, and `useIsMobile()` in JavaScript | Is there room for the desktop chrome? | Phone shell or desktop shell: the rail, split panes, page-sheet margins |
| Container | `@sm:`, `@md:` … under `@container` | How wide is THIS component's box? | A component's own arrangement, wherever it is mounted |

`sm:` alone still answers "is there horizontal room for a row?" (a footer's
buttons side by side, a two-column form), and a phone on its side, at 852px
wide, has that room.

**A phone on its side is still a phone.** An iPhone in landscape is 852 x 393.
Tailwind's own `md` is "at least 768px wide", so it got the desktop shell in
393px of height and every `md:opacity-0` reveal hid its control from a finger.
`globals.css` redefines `md` and `max-md` to exclude a phone on its side (a
coarse pointer, at most 500px tall, narrower than `lg`), and `useIsMobile()`
reads the same query from `hooks/use-is-mobile.ts`, so a class and a hook can
never disagree about one screen. `lg:` and up are Tailwind's own: no phone
reaches them. A breakpoint question in JavaScript uses the exported queries,
never a hand-written `(max-width: 767px)`; `breakpoints.spec.ts` holds the CSS
and the TypeScript to one string and fails on a raw `md` width.

## Component layers (atomic design)

The UI is built atomically: **atoms** compose into **molecules**, molecules into
**organisms**, and only then into a route. The vocabulary is already in the code:
`project-atoms.tsx`, "the shared `SearchField` molecule", "the organisms import
from HERE". This section is what it means, because the layering is
a rule and not a filing convention.

| Layer | Where it lives | What it is |
|---|---|---|
| Atom | `components/ui/` for the product-wide kit; a local `*-atoms.tsx` or a `viewer/`-style kit folder for a surface's own | One decision each: a shape, a control, a piece of material. Knows no domain |
| Molecule | `components/ui/`, `components/<area>/` | A few atoms with one job. `SearchField`, `PageHeader`, `RaisedCard`, `LoadError` |
| Organism | `components/<area>/`, `features/<domain>/components/` | A meaningful chunk of a screen. `ProjectCard`, the viewer rail, the model stage |
| Route | `app/**` | Composition and data, not markup |

Three rules carry the weight:

**An organism reaches for an atom, never for Tailwind.** If a control needs a
shape the kit does not have, **the kit gains an atom** rather than the organism
gaining a `<div className="…">`. `features/bim/components/viewer/index.ts` is a
barrel that exists purely to enforce this: eleven atoms, exported from one place,
and everything the model stage draws is built from them. The viewport before it
had four floating panels in three different materials, all written inline, none
testable.

**A second surface showing the same thing composes the same atoms.** It does not
hand-roll a lookalike. Two lookalikes drift on the first token retune, and the
divergence surfaces as one card with a different corner radius or a hover lift
that does not match. `project-atoms.tsx` exists so a genuinely different
*arrangement*, the dense list row next to the card grid, is still made of the
same material.

**Shape is a primitive; domain is an atom on top of it.** The raised white plate
on a subtler tray is `components/ui/raised-card.tsx`. What makes it a *project*
is `project-atoms.tsx`. Re-declaring the geometry in the domain file is how you
get the fifth hand-rolled copy of `rounded-b-[10px] bg-card shadow-xs`.

The layer names carry weight in review. "Make it an atom" and "that belongs in
the kit" are the two most common notes on a UI diff.

## Overlays: pick by what the content IS

The rule was already written, in two file headers nobody finds until they are
already editing one (`components/ui/sheet.tsx`, `components/ui/page-sheet.tsx`).
It lives here now, because the question it answers — "should this be a modal?" —
arrives from outside the code, and the honest answer is that SIZE is not the
criterion. All three of these are the same Radix Dialog underneath, so focus
trapping, Escape and scroll locking are identical; what differs is intent.

| Use | When the content is | Example |
|---|---|---|
| `Dialog` | One question with an answer — confirm, rename, a short form — or one artifact you look at with full attention. What is behind it does not matter while it is open. Also a self-contained conversation opened from the shell menu and closed again, with its own list beside it, when it belongs to no page: two panes from `md:` up, one with a back step below, full screen on a phone. | `ConfirmDialog`, `skill-editor-dialog.tsx`, the PDF viewer, „Mein Feedback" (`feedback-threads.tsx`) |
| `Sheet` (side) | The DETAIL of a row the reader just selected. The list stays put behind it and keeps updating. | `task-detail.tsx`, `schedule-detail.tsx`, `skill-detail.tsx` |
| `PageSheet` | A whole PLACE, independent of wherever the reader is standing. Route-backed, reached from the org nav. | Postfach (on a phone and below `lg`; docked above), Archiv, chat history |
| `Popover` | A transient choice attached to the control that opened it. Never a panel with its own header and scroll region. | the `/` command picker, filter menus |
| `HoverPeekPanel` | A glance at what a reference in running text stands for: hover or focus to see, click or tap to pin, Escape or an outside click to close (`useHoverPopover`). Mounted on first engagement and BESIDE its trigger, never around it, so a page of references costs nothing until one is looked at and the trigger never remounts. | citation chips, `[N]` markers, Herleitung source cards, file references, @-mentions |
| `Collapsible` | More of THIS row, in place. No scrim, nothing dimmed. | the wizard's „Erweitert", the document lifecycle panel |
| No overlay | A multi-step flow that owns its section, or a second pane you read the first pane AGAINST. | `ScheduleWizard` inline in Tasks, the file peek |
| Docked panel (`DockedSplit`) | A list you WORK, entry after entry, beside the real place each entry opens. Not an overlay: it is beside the page, never behind anything, and the page's own overlays (`PageDialog`, the file preview) cover the page and leave it usable. It never draws a copy of what an entry opens ([ADR-0148](../adr/0148-a-list-is-worked-beside-the-real-surface-never-a-copy.md), [how](../architecture/docked-panels.md)). | the Postfach docked from the bell, the file peek beside the chat |

Two corollaries that are the whole reason the table exists:

**An editor form is a `Dialog`, never a `Sheet`.** An edit is a question, and a
question wants the page behind it to stop mattering. A `Sheet` full of fields
with a Save footer is a form pretending to be a detail view, and it gets the
one behaviour a form must not have: Escape and a scrim click discard the edit
with nothing asked.

**On a phone a `Dialog` is a bottom sheet.** Below `sm`, and on a phone on its
side (`phone:`), `DialogContent` anchors to the bottom edge, rounds its top,
caps itself in `dvh` under the status bar and scrolls inside. Its
`DialogFooter` is pinned to the bottom edge with its paper running under the
home indicator, and below `sm` its buttons stack full width in DOM order, so the
primary action (last, as it is rightmost on a desktop) is the one nearest the
thumb. A grabber says it pulls down, and it does: past 96px or on a flick, the
same two numbers the page sheet commits on (`sheet-pull.ts`). On a long sheet
the grabber, the close and a leading `DialogHeader` stay at the top while the
body scrolls under them, and a hairline marks each pinned edge only while
content passes beneath it. It arrives on
`--motion-deliberate` / `--ease-entrance` and leaves one step shorter; no
spring, because its travel is its own height. From `sm` up on anything else it
is the centred card, unchanged. Under a finger the dialog (and a side `Sheet`) itself takes focus on
open, not its first field: a focused field raises the keyboard over the sheet
before the reader has read it (`overlay-focus.ts`). A pinned footer is the
primitive's; a caller never adds its own `sticky`. `fullScreenOnMobile` (or
`mobilePresentation="fullscreen"`) takes the whole screen instead, below the
status bar, for an editor with several sections. A dialog that lays itself out
(sets its own `top`, `bottom`, `inset`, `translate-y` or height) keeps its own
geometry on a phone, and one that replaces the padding owns its safe area: the
primitive never paints over a caller's explicit class on the screens nobody
reviews on. `mobilePresentation="none"` says so outright.

**Every overlay has a visible close on a phone.** The pull is a shortcut nobody
is told about; the X is the way out everyone recognises. The page sheet shows
its X on every viewport, and its grabber pill is a real 44px tap target too.

**One viewer per kind of thing viewed.** Not "one viewer per surface that
happens to show it". The same stored file opened from Files and from the Archiv
must be the same component; two of them drift on the first change to either,
and each looks locally correct while doing so.

**Stacking.** One `Dialog` over one `Sheet` is fine — a confirm inside a detail
drawer is the shape people expect. Two drawers is not: two stacked modal focus
traps, and the reader cannot tell which list they are going back to.

**Getting back out.** Every overlay closes on Escape, on its own X, and on a
scrim click, and Escape does exactly ONE thing: close this overlay.

The one exception is the reason editor forms are `Dialog`s at all: **an editor
with unsaved changes does not close on any of the three.** All of them route
through the same discard confirmation, because a form that throws work away on
a stray Escape has the failure the rule above was written to prevent, and it has
it whichever gesture triggers it. A clean editor — nothing typed, or everything
saved — closes like any other overlay; the confirmation is about the unsaved
edit, not about the form. The shared form is `useUnsavedEditGuard` (`components/ui/unsaved-edit-confirm.tsx`): it takes the editor's `onOpenChange` and its dirty flag, and asks „Änderungen nicht übernehmen?“ (`common.unsavedEdit`). Never „verwerfen“ there: in the E-Mail-Eingang that word says no to a whole mail. The E-Mail-Eingang's „Ändern“ dialog and the Verlauf's „Herauslösen …“ name field use it; the custom-role, skill and sketch editors still carry their own copies of the question.

An overlay whose state is worth sending to a colleague puts that state on the
URL with `push`, so browser Back closes it. One whose state is not worth sharing
stays off the URL entirely. `replaceState` is the option that looks like a
compromise and is not: it produces a URL that promises a link and a Back button
that lies. When the URL carries the state, ONE place owns writing it: the
overlay opening pushes, the overlay closing replaces, and the reader's own
navigation is followed rather than fought. Two effects each pulling one way is
how Back ends up doing nothing.

## Component patterns

**Inspector** — facts about one object on a sunken rail are inset grouped lists:
`InspectorSection` (a quiet label inset to the group's content edge, closer to
its group than to the one before), `InspectorGroup` (one white sheet per
question, `rounded-lg border shadow-2xs`) and `InspectorRow` (glyph, label,
value; hairline inset past the glyph; the row owns the type of both columns, so
a value passed in carries no size of its own). `components/ui/inspector-group.tsx`;
the preview rail is the reference (`docs/ux/file-upload-and-explorer.md`, „The
preview pane"). A disclosure inside a group is a row with a trailing chevron,
never a fourth eyebrow.

**Project card** — "a project, listed" has ONE component: `ProjectCard`
(`components/projects/project-card.tsx`). Rails, grids, pickers and any future
project surface render that card; a surface that genuinely needs another
arrangement (the dense projects-home row) is composed from
`components/projects/project-atoms.tsx`, the same material the card is made of.
Never hand-roll a lookalike — two of them drift on the first token retune. The
inventory, the honesty constraints on status and timestamps, and the decision
procedure are in **`docs/design/project-surfaces.md`**.

**Status on a card is a SWATCH — a 10px rounded square on the title line.**
Never a coloured rail down the card's edge, and never a tint across the whole
sheet. Both were tried on the task card and both fail the same way, by making
the status the loudest thing on a card whose subject is its title: a rail is a
third material on an anatomy that has two (a white sheet laid into a tray), and
a tint shouts — a red card is a red card even when the failure it names is four
days old and already understood.

The swatch is the quiet version of the same signal, and it is a shape this
product already uses to mean "this colour stands for this row": the timetable's
legend and the schedule cards pair exactly this square with a name. Reusing it
costs nothing to learn. `features/tasks/components/task-card.tsx`
(`STATUS_SWATCH`) is the reference.

Colour is never the only carrier. The swatch is a scan anchor; the status is
always also stated in words, in the chip under the title.

**Emphasis without a stripe.** Side stripes are discouraged: a coloured or
ruled bar down the left edge of a box, used as decoration or emphasis. The
reason is the product owner's preference, stated on 2026-10-27, after the UI had
grown one on callouts, cards, quotes, toasts, peeks, inbox rows and timetable
chips. Each did what the task card's rail did (above): the edge became the
loudest thing on a box whose subject is its content, and where it carried a
status it carried it in colour alone. This replaces the old quotation rule
(`border-l-2 border-border` on someone else's words). Prefer, in this order:

| To say | Prefer |
|---|---|
| These are someone else's words (a comment, a question asked, a lesson) | `Quote` (`components/ui/quote.tsx`): indented, italic, muted ink |
| This passage is the source's wording | `Quote variant="excerpt"`: a quiet tinted surface with the card radius |
| This wording is not verified | `Quote variant="paraphrase"`: upright, a dashed full hairline, and the stamp saying so |
| This block belongs together / stands apart | A tinted surface (`bg-muted`, the semantic tint) or a full hairline border with radius |
| This is a success, a warning, a Frist | An icon and a word (`Chip`, `Alert`, the callout's eyebrow), the colour only reinforcing them (WCAG 1.4.1) |
| This row is unread / this series is this colour | `AttentionDot` in the leading gutter; the 10px swatch beside the name |

A 1px `border-l` is still the right tool as a **structural divider**, where it
separates two things side by side: a pane seam, a table or timetable column, a
segmented control's segments, a timeline's axis with its nodes, a tree's guide
line. If a stripe seems genuinely the clearest answer somewhere else, say why
in the review.

**Page header** — every content page opens with `PageHeader`
(`apps/workspace/ui/components/ui/page-header.tsx`), so the title stays on-spec
(`text-xl`) instead of drifting:
```tsx
<header className="flex min-w-0 flex-col items-stretch gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
  <div className="min-w-0">
    <h1 className="text-xl font-medium">{title}</h1>
    <p className="mt-1 text-sm text-muted-foreground">{oneLineContext}</p>
  </div>
  <div className="sm:shrink-0">{primaryAction}</div>
</header>
```
The action stacks below the title on a narrow screen and only refuses to shrink
once there is a row to sit in. It was an unconditional row with a `shrink-0`
action, which a phone cannot honour: the action takes its natural width — a
256px search field, a toggle group — and the title column absorbs the whole
shortfall. Measured at 390px, the History subtitle rendered 44px wide across
eight lines, one word per line. Never reintroduce a bare `shrink-0` here;
`page-header.spec.ts` fails it.

**Project section chrome** — every project section except **Chat**
opens with the same block: a muted `{project} / {section}` breadcrumb
trail, then the `PageHeader` title + one-line subtitle, then optional actions
on the right. The two shapes are an action button (Files' view toggle,
Automation's "New job"/"New skill") and title-only (Settings, Knowledge). The
intake wizard is a content page too — `PageHeader` plus a `SectionLabel`
eyebrow, never a second `text-2xl` title. Projects home (above a project) uses
the same `PageHeader`.
Chat is the documented exception: it is a full-bleed conversation surface with
its own toolbar, not a content page. Evidence: `/dev/project-chrome`.

**Section** — eyebrow label + content, no heavy chrome:
```tsx
<section className="space-y-3">
  <SectionLabel as="h2">{label}</SectionLabel>
  {content}
</section>
```

**Back navigation** — pages outside the project shell that still render as a full page rather than a sheet (Organisation, Platform, Profil) drop the rail for the org-scope header, so their back control is the whole way out. It is `BackLink` (`components/shell/back-link.tsx`), never a hand-rolled `<Link>`: an arrow in a raised disc plus a label that **names where the reader actually came from**, read from the tab's return trail (`lib/navigation/return-trail`, recorded by `NavigationTrail` in the root layout). Out of a project the name is the PROJECT'S — "Zurück zu Stadthaus Wien" — written into the trail by `NavigationTrailLabel` in the project shell while the reader was there, because a path holds an id and an id is not a name, and leaving that project is what the reader is undoing. Everywhere else the label comes from the destination's own `nav.sections.*` entry, so the wording cannot drift from the rail's. Navigation goes through `history.back()`, which restores the page as it was left — scroll position and open panels included — where a push to the same URL would not. The scroll half of that promise is not the browser's: the shell scrolls `<main>`, and the browser restores only the window, so `MainScrollMemory` (`components/shell/main-scroll-memory.tsx`) remembers `<main>`'s offset per URL and puts it back on Back and Forward. Each page still passes a server-resolved `fallbackHref`/`fallbackLabel` for the case with no trail (new tab, direct link). A back control that guesses a destination is worse than none: it teaches the reader that back does not work.

The Archiv and the Postfach are NOT this case since the org-nav redesign: they rise as `PageSheet`s (`components/ui/page-sheet.tsx`) over whatever the reader was looking at — a project's rail included — so "back" is the sheet's own close control (`router.back()` for the intercepted route, a push to `/app/projects` for a hard load), never `BackLink`. A sheet's whole visual claim is that the page underneath is still there; a `BackLink` would say the opposite.

**Page sheets pull down.** Every `PageSheet` is bottom-anchored on every viewport, with a sliver of app visible above its top edge and a grabber band at the top: grab the band (or the header) and pull past ~96px, or flick, to dismiss — on touch and with a mouse alike. An uncommitted pull snaps back on `springGlide` (the reader's own gesture handed back; travel unbounded, so that is the calibrated spring). The grabber's pill is also a real close button, so keyboard and AT keep a non-gesture close; below `md` it is the *only* visible close control — the header X is desktop-only, because a grabber and an X side by side are two controls asking the same question. The panel animates through motion.dev (`motionSheetEnter` / `motionSheetExit` in the motion kit), not CSS keyframes: a keyframe and a drag both write `transform`, and the loser jumps. Route-backed sheets navigate in `onExitComplete`, never on the close click — navigating immediately unmounts the page under the sheet mid-slide.

Tabbed shells (Organisation, Platform) are **one place**, not a stack of submenus. Switching Models → Knowledge `replace`s the URL and collapses those siblings on the trail, so Back leaves the shell and returns to the project — it does not walk the previous settings tab. Project sections stay a real stack: Files → Chat is a step.

**Stat** — `rounded-lg border bg-card p-5 shadow-xs`, number in `text-2xl font-medium tabular-nums`, label in `text-sm text-muted-foreground` below. A leading icon sits in a `StatCardIcon` well (`components/ui/stat-card.tsx`: the chip tint pairs plus the office provenance tint, `size-9`/`size-7`). Stat vs charter Figure (§A2): a Stat is a dashboard tile whose number *is* the content; a Figure is the one emphasized answer *inside* an evidence card. A tile never carries a Figure, a card never carries a Stat.

**Search** — `SearchField` (`components/ui/search-field.tsx`) is the one magnifier + input + clear control. Archiv composes it inside `FileSearchBar` (sticky band, run button, result banner). Files composes the bare `FileSearchField` in the page header instead — no sticky band, no run button (Enter alone commits the semantic search), no banner (the results are the report); `useFileSearch` owns the two-mode query state one level above both the field and `FileBrowserPane`. Admin lists compose `SearchField` inside `DataToolbar`. Do not hand-roll another `relative` + `Search` icon + `Input`.

**Exclusive / multi filters** — `ToggleGroup` (`components/ui/toggle-group.tsx`). Segmented icon clusters (Files view switcher) use `segmented`. Inverted pills (folder / category chips) use `variant="inverted"`. Exclusive form choices with a description (the wizard's cadence: einmal / wiederkehrend / nur manuell) use `RadioGroup`, not a toggle row. A `segmented` cluster **hugs its segments** (`w-fit`) and scrolls rather than overflowing when they do not fit — `flex` alone is block-level, which left a tray stretched across a `max-w-3xl` column with a dead zone bolted to its right, and at phone width ran the last segment off the card where nobody could press it.

**Form field** — `Field` + `FieldLabel` + `FieldDescription` + `FieldError`. TanStack-backed forms wrap the same anatomy through `FieldShell`. Raw `<label>` next to an `Input` is a leftover.

**List container** — `ItemList` (`rounded-lg border divide-y`) with `Item` / `ItemMedia` / `ItemContent` / `ItemTitle` / `ItemDescription` / `ItemActions`. That is the list molecule for the chat history sheet (`SessionsPanel`), Inbox, Settings rosters, and admin pickers. Do not hand-roll a second `rounded-lg border` + `divide-y` row. The raised product card (Files tiles, project cards) is `RaisedCard`, not `Item`.

**A row in a list is connected, never a pill.** `ItemList` owns the outer corners (`overflow-hidden`) and the hairlines between rows (`divide-y`), so only the first and last row round, and the seam is one line rather than two stacked borders. A row (`Item`) takes no radius, border or shadow of its own. Hover tints the row and does not lift it, because a lifted row detaches from its neighbours. A drop target marks itself with `ring-inset`, since an outer ring on the first or last row is clipped; the selected row and the keyboard's row mark themselves inset too (`Item`, above under „Warning gold“). A row of a list is `Item`, even a dense one with a checkbox and a stretched link (the E-Mail-Eingang's `InboundMailRow`): its padding, hover and states come with it. The three layers are the atom `Item` (one row), the molecule `ItemList` (the connected run), and the organisms that fill it (`ProjectListRow`, `FolderRow`).

**Empty state** — `EmptyState` (`components/ui/empty-state.tsx`), never bare
text and never hand-rolled. The icon sits in a **raised disc** — border, card
surface, soft shadow — because a disc that catches the light reads as
considered where a flat muted circle reads as a placeholder. `variant="panel"`
adds the dashed container; the bare variant is for an empty region inside a
surface that already has a border.

```tsx
<div className="flex w-full min-w-0 flex-col items-center justify-center text-center
                rounded-lg border border-dashed bg-muted/25 px-6 py-12">
  <div className="mb-4 flex size-12 items-center justify-center rounded-full
                  border bg-card text-muted-foreground/70 shadow-sm">
    <Icon className="size-5" aria-hidden />
  </div>
  <p className="text-balance text-sm font-medium text-foreground">{title}</p>
  <p className="mt-1.5 max-w-sm text-pretty text-sm leading-relaxed text-muted-foreground">{whyAndWhatToDo}</p>
  <div className="mt-5">{primaryAction}</div>
</div>
```

**Loading** — Skeletons matched to the real content's shape (never a spinner for page-level loads; spinner only for inline/button-level). Match row heights and counts to the eventual layout.

**Error** — a load that failed where its content should be is `LoadError` (`components/ui/load-error.tsx`): a destructive `Alert` with the warning glyph, the failure in the surface's own words as its title, an optional hint, and a retry that is a `BusyButton` (busy is not disabled; it stays busy while the promise `onRetry` returns is in flight, or while the caller's `retrying` says so), plus any further `actions` (Answer feedback's „clear filters"). Never compose `Alert` + `Button` for this by hand: the twenty-one copies it replaced had drifted on glyph, title-vs-description and `disabled`. A pane the failure empties entirely (the task list, the file workspace) keeps `EmptyState tone="destructive"` with a retry action. `sonner` toast for transient action failures; inline field errors for forms (already handled by the TanStack Form FieldShell). Error red (`--signal-error`) is for errors only — never for emphasis.

**Counts** — `CountPill` (`components/ui/count-pill.tsx`) is the one rounded-full numeric pill. `tone="muted"` (default) for a quiet number beside a heading or tab label; `tone="attention"` — near-black action ink — only when the count *is* the signal that something waits for the reader (the inbox badge). Never hand-roll a third shape; never reach for chroma here (ink, because chroma belongs to provenance). A number goes in as `count={n}`, never as children: the pill caps it at `max` (default 99) and shows `99+`, so a big figure cannot widen a filter segment or a nav row, and the exact figure stays in the pill's `title` and in a screen-reader-only span. `children` is for words and ratios the caller composed („3/8 erfasst", `+4`, a locale-formatted analytics figure), which the pill shows as given. `max={Number.POSITIVE_INFINITY}` only where the exact number is the content and the row has room (the IFC explorer's element counts).

**People** — a group of people is `AvatarStack` (`components/ui/avatar-stack.tsx`): overlapping `Avatar` discs in the order given (it never re-sorts — ordering is the caller's information), ring-separated, tail collapsed into a neutral `+N`. `sm` is 28px, not 24px: below that the overlap plus the ring clips the second initial. A single disc is `PersonAvatar` from the same module. Identity colour and initials come from `components/ui/avatar-identity.ts` — keyed on the **user id** so one colleague is one colour on every surface, and generated as a hue only: lightness comes from `color-mix()` against `--card`/`--foreground`, so dark mode needs no second palette. **Identity is not signal**: these tints carry no meaning, always ride with initials or a photo, and are deliberately off the provenance hues.

**Scroll boundaries** — a bounded list that clips its next row through the middle of its text reads as broken, not as "there is more below". Dissolve the edge with the `scroll-fade-bottom` utility (`app/globals.css`) on the scroll container itself. It is a **mask**, not an overlay gradient: masking composites against whatever surface the list happens to sit on (popover, card, dialog), so it names no colour and light/dark are free — an overlay would have to hard-code a surface token and be wrong on the next surface. It stays a one-line utility rather than a wrapper component precisely because it is one paint rule with no DOM, no state and no children. Anything that must stay sharp (a keyboard-hint footer, a dialog footer) belongs *outside* the faded scroll region.

**Warning gold is a glyph colour, not a small-text colour.** `text-warning` measures 4.48:1 on the paper background and about 4.2:1 inside `Alert variant="warning"` at 12–14px (axe `color-contrast`, measured 2026-10-22), under the 4.5:1 WCAG AA asks of body text. A warning line that a person must read before acting draws its glyph in `text-warning` and its words in ink, a step heavier: `FactLine tone="warning"` (`components/ui/fact-line.tsx`), and a default `Alert` with a gold icon. The signal red takes the same cure on a line (`FactLine tone="danger"`): red words measured 4.08:1 on the danger tint and barely 4.5:1 on paper, so a line that says filing is impossible („Schadsoftware gefunden“) draws a red glyph and ink words. The kit's `Alert variant="warning"` itself still fails the ratio wherever it carries text; retuning `--warning` (or that variant's text) is the open fix. Likewise a selected row does not take a tint under muted text (`bg-accent/70` behind `text-muted-foreground` is 4.33:1): it lifts to `bg-card` and draws the selected hairline (`--border-color-brand`, the ramp's .32 step) all round, inset (`inset-ring-strong`). That is `Item`'s current state (`aria-current="true"` on the row, or `data-current` where the row's link carries `aria-current` itself). A row the keyboard walks to while the focus stays put (J/K) is `data-cursor`: the keyboard's own ring, inset. Neither is a bar down the leading edge: that was the selected row's mark until 2026-11-03, and it is the stripe **Emphasis without a stripe** retired.

**Measured contrasts that decide a token (axe `color-contrast`, 2026-10-22).** `Tabs`' inactive label was `text-muted-foreground` on the strip's `bg-muted`: 4.44:1 at 12px, so the kit's `TabsList` now inks it `text-foreground/70`; the muted `CountPill` had the same pair (4.44:1 at 11px, 2026-10-27) and takes the same ink. The kit's `Alert variant="destructive"` drew its words in `text-error` on `bg-danger-subtle`, 4.08:1; since 2026-10-27 it takes the warning line's cure, the signal red on the glyph and the words in ink (`components/ui/alert.tsx`, held by `alert.spec.tsx`), and `LoadError` inherits it. A must-not-miss stop is still the default `Alert` with the signal red on its glyph and on its full hairline (`border-danger`, `features/inbound-mail/components/impersonation-warning.tsx`), the words in ink: a stop is not an error surface, and it carries no leading rule (**Emphasis without a stripe**). Muted text directly on the preview rail's `bg-surface-sunken` measures 4.41:1: a rail section sets its rows on a card (`InspectorGroup`, the „E-Mails“ tab's list) rather than straight on the sunken ground.

**The agent's mark claims the agent.** `FilingChip` draws `AgentGlyph` only when its target IS a stored the agent suggestion (`suggested`, default true for the suggestion surfaces); a folder a rule picked (the E-Mail-Eingang's correspondence default, `defaultThreadFolder`) or the person chose wears a plain folder glyph. A mark on a rule's guess is a false claim, and on an unconfirmed or forged mail it puts the agent's weight behind a stranger (`lib/inbound-mail/suggest.ts`).

**Status badges** — Badge variants: `success` (ready/completed — project green family), `info` (in-progress/running — law blue family), `warning` (needs attention — office gold family), `danger` (failed — the signal-red tint, the same pair as Chip and Alert), `secondary` (neutral/cancelled). `destructive` is the solid red plate, action weight: a status that says something failed is a fact in a row and takes `danger`, or a four-day-old failure is the loudest thing in the list. A document's status (`DocumentStatusBadge`, the upload tray's row) carries a glyph per state from one table (`features/documents/components/ingestion-atoms.tsx`), because several states share a colour: „Wartet" and „Wird gelesen" are drawn in ink (the status family stays `info` in `data-variant`; reading is the normal course, and colour is red and ochre), „Abgelegt", „Abgebrochen" and „Unbekannt" all grey, and the glyph is what tells them apart. Project status chips: "Aktiv" = `--status-active(-tint)` (green), "Abgeschlossen" = `--status-done(-tint)` (warm gray) — always dot/icon + label, never a bare color dot.

## Motion vocabulary

One scale, one set of curves, four springs. Durations and easings are tokens
in `src/styles/tokens.css`; the springs and tweens live in
`src/components/motion/index.tsx`. **Never write a literal duration or
cubic-bezier in a component.**

### Durations

| Token / class | ms | For |
|---|---|---|
| `--motion-snap` / `duration-snap` | 120 | Press, checkbox tick, hover on dense rows |
| `--motion-quick` / `duration-quick` | 180 | **Default.** Colour, opacity, small transforms, chip in/out, row exit |
| `--motion-base` / `duration-base` | 240 | Content entrance (fade+rise), popover open, accordion height, skeleton→content |
| `--motion-deliberate` / `duration-deliberate` | 320 | **Ceiling.** Sheet, drawer, wizard step, panel open/close |
| `--motion-ambient` / `duration-ambient` | 1600 | Indeterminate loops: progress sweep, typing dots, connection ping |
| `--motion-ambient-slow` | 2600 | Text shimmer |

Exits run **one step shorter** than their entrance. Nobody wants to watch a
thing they just dismissed.

### Easings

| Token / class | cubic-bezier | For |
|---|---|---|
| `--ease-out` / `ease-out` | `0.23, 1, 0.32, 1` | Colour, opacity, hover, press. Also the default for any transition utility that names no curve |
| `--ease-entrance` / `ease-entrance` | `0.16, 1, 0.3, 1` | Anything that **moves** on arrival |
| `--ease-exit` / `ease-exit` | `0.23, 1, 0.32, 1` | Anything **leaving**: it starts at once |
| `--ease-cycle` / `ease-cycle` | `0.65, 0, 0.35, 1` | **Only** looping / indeterminate motion |

**Why `--ease-out` is strong.** It was Tailwind's stock `0, 0, 0.2, 1`, which
spends its first third barely moving. A press or a hover is feedback, and
feedback is read in the first frames, so the curve front-loads the change
(Emil Kowalski's strong ease-out). A transition utility with no `duration-*`
or `ease-*` of its own runs on `--motion-quick` and this curve
(`--default-transition-*` in `tokens.css`), not on Tailwind's 150ms.

**Why exits no longer accelerate away.** `--ease-exit` was `0.4, 0, 1, 1`, an
ease-in, on the argument that a dismissal that decelerates looks reluctant.
In practice the ease-in was the reluctant one: after an Escape or a scrim click
the surface barely moved for the first third of its run, which is exactly when
the reader is watching to see the dismissal land, and a flicked sheet stalled
before it left. Exits now start at once on the same strong ease-out, and stay
one step shorter than their entrance; the tail runs while the surface is
already nearly gone. The token keeps its own name so exits can be retuned
without touching every hover.

No `ease-in-out`, no `ease-in`, no bare `ease`, and no `linear` on a
transition. `linear` is allowed in exactly one place: inside a loop's own
`@keyframes` / `animation` shorthand where the motion is a constant velocity
with no arrival in it, a spinner's rotation (`animate-spin`) or a band sweeping
across a label (`animate-shimmer-*`). A wheel turning at a steady speed is the
physical case; easing it would make the spinner lurch once per turn. A loop
that breathes or shuttles still takes `--ease-cycle`. A lint rule
(`grid/motion-vocabulary`) flags `transition-all`, `ease-linear`, `ease-in`,
`ease-in-out`, `animate-pulse`, literal durations, hand-written
`[animation-delay:…]` / `[animation-duration:…]`, transitions on
layout-triggering properties, and `height`/`width`/`top`/`left` in a motion
`initial`/`animate`/`exit` object (see *Height* below for the sanctioned case).

### Springs

| Name | stiffness / damping / mass | ζ | Overshoot | For |
|---|---|---|---|---|
| `springPress` | 600 / 38 / 0.6 | 1.00 | **0%** | Press and release, tap scale, checkbox. Chosen for interruptibility and velocity carry-over, not bounce — a tween cannot resolve a press interrupted mid-flight. |
| `springSnap` | 520 / 30 / 1 | 0.658 | **6.4%** | **Travel ≤ 24px only.** Toggle thumb, segmented indicator, icon swap, landing file, snap-back. |
| `springDrawer` | 260 / 26 / 1 | 0.806 | **1.4%** | **Travel ≤ ~145px.** Large but BOUNDED surfaces: a dialog, wizard step, a card settling. |
| `springGlide` | 260 / 29 / 1 | 0.899 | **0.157%** | **Unbounded travel.** The distance is not knowable when the transition is written: shared-layout chips, anything whose travel is the reader's route history. |

`springSnapLinear` / `springDrawerLinear` are CSS `linear()` equivalents for
Radix-driven, class-only cases (`Switch`). A zero-overshoot spring needs none —
it *is* an ease-out.

**Overshoot is budgeted in pixels, not percent.** 6.4% of an 18px toggle thumb
is 1.2px — a detent you feel. 6.4% of a 400px drawer is 26px — a trampoline.
Same number, opposite verdict. That is why `springSnap` carries a 24px ceiling
as part of its contract rather than as advice.

**Which is why there are four and not three.** The first three each hold the
pixel budget up to a ceiling, so picking one means knowing the travel in
advance. Sometimes you cannot: the nav rail's active pill is a shared-layout
chip whose distance is whatever the reader's last two routes happen to be —
38px between neighbours, 288px from the top of the column to Inbox at the
bottom. On `springDrawer` the short hop is 0.53px and the long one is 4.0px,
which on a 38px row pitch is the pill barging into the row above its target.
`springGlide` is calibrated the other way round: ζ high enough that the pixel
overshoot is in budget at *any* distance (0.44px at 288px, 0.69px at 448px)
rather than up to a ceiling. It shares `springDrawer`'s natural frequency, so
only the landing differs, not the arrival time.

**A `layoutId` is global, so it has to be scoped by hand.** `layoutId` names
ONE travelling element across the entire React tree, not one per component —
two mounted at once are the same element, and the pill flies between them. This
shipped twice: `ToggleGroup` used the constant `"toggle-pill"` while the Tasks
tab mounts two segmented groups together (the view switcher above the status
filter row), and `Tabs` used `"tabs-pill"` for every strip on the page. Both
now take a `React.useId()` per instance, the way the nav rail already keyed its
own pill by rail width (`railActivePillId`). The rule: **one shared-layout id
per mounted group, never a module constant.** Since the id never reaches the
DOM, both atoms mirror it onto `data-pill-id` so a collision is visible in
devtools and assertable in a test rather than only in the animation.

**And why a sheet takes a tween.** Past roughly 300px of travel there is no
spring left to pick: anything with a perceptible overshoot percentage is out of
budget by construction, and anything damped enough to stay in it is an ease-out
with extra steps. A sheet's travel is its own width — 288px on the mobile nav,
448px for a `sm:max-w-md` panel — so it takes `--motion-deliberate` on
`--ease-entrance`, the same pair the side sheet and the page sheet use. A panel half the screen
wide flying 6px past its edge and coming back is precisely the failure the
pixel budget exists to catch.

### When a spring is earned

A spring is earned when **the motion's trajectory carries information the
endpoint does not.** Three ways:

1. **Continuation** — the element is completing an input the user made in the
   last ~400ms. The spring is their gesture's momentum, handed back.
2. **Direction of travel** — it came from somewhere and the reader must know
   where, so it can be found again.
3. **Snap-back** — it failed to reach a destination and returned. The overshoot
   *is* the message "that didn't take."

Everything else is a tween. **Four vetoes override all of the above:** travel
over 24px never uses `springSnap`, and travel over ~145px never uses
`springDrawer`; anything carrying legal, evidentiary,
provenance or error content is tween-only; and anything appearing more than
about five times per screenful is tween-only, because a spring repeated thirty
times stops being a physical cue and becomes texture.

### Fixed choreography

- **A keyboard-summoned overlay does not animate.** The ⌘K palette and the
  `?` cheatsheet open and close in one frame, panel and scrim alike
  (`DialogContent instant`; `CommandDialog` is instant by default). They are
  opened from the keyboard many times a day, and an entrance there is latency
  between the keystroke and the thing asked for. A dialog opened with a click
  on an occasional task keeps its entrance.
- **Toasts move on Sonner's paths and our clock.** A toast drops in from the
  edge it sits on and leaves through it, and the stack lifts and expands, all
  through Sonner's own CSS transitions, which `globals.css` retimes onto
  `--motion-base` / `--ease-entrance` (leaving: `--motion-quick` /
  `--ease-exit`). Transitions, not keyframes: a toast dismissed while it is
  still arriving turns around from where it is.
- **Tooltips: one delay, then instant.** One `TooltipProvider` at the root
  (`components/ui/tooltip.tsx`; a `Tooltip` joins the one above it and only
  mounts its own where none exists). The first tooltip waits 300ms
  (`TOOLTIP_OPEN_DELAY_MS`), then fades and scales from its trigger on
  `--motion-quick`; within 300ms of one closing the next opens at once with no
  entrance at all (Radix's `instant-open`), so reading along a toolbar keeps up
  with the pointer. No slide: the scale from the trigger already says where it
  came from. Keyboard focus opens it instantly too. A provider of its own
  breaks the chain, so a surface adds one only to change the delay on purpose
  (the usage charts do).
- Content entrance: `animate-in fade-in-0` (+ `slide-in-from-bottom-1` for
  cards) via tw-animate-css.
- **Chat turn entrance: the thread row owns it.** Every block arriving in the
  transcript (a question, an answer, `AgentPrompt`, the `ErrorBanner` /
  `NoSourcesBanner` notices) enters with its row in `ChatArea`: a fade and a
  4px rise on `motionEntrance`, for genuinely new messages only. **Component
  roots carry no CSS entrance of their own.** A root's `animate-in` plays on
  every mount, so a restored thread replayed every bubble's entrance and a new
  message stacked two. A row leaving gives up its height with its opacity.
- **State changes inside an arrived turn are transitions, not entrances**:
  `AgentPrompt` dims to `opacity-75`; the answer's meta row is reserved at chip
  height (`min-h-6`) so late chips cannot grow the footer.
- **A card that moves glides; a filter press does not.** A task card that
  changes place under the reader (into another recency bucket, out of a
  narrow filter it no longer matches, pushed down by a new run) travels on
  `springGlide` with `layout="position"` and a `layoutId` per task, and the
  cards and bucket sections around it make room on the same spring. Position
  only: a card that grew takes its height at once. A filter swap must not move
  anything, so the shared layout is scoped to the filter: the group is keyed
  by it (every card remounts) and the filter is part of every `layoutId`, so
  no card has a namespace-mate in the old list to fly from; `useSwapFade`
  fades the new rows in. Reduced motion lands the card in one frame
  (`useMotionToken`). `features/tasks/components/task-list.tsx`; the ids are
  mirrored onto `data-layout-id` and asserted in `task-list.spec.tsx`.
- **Staggers are always capped** — `Stagger` ships a ceiling
  (`staggerMaxSteps`), because an uncapped stagger delayed one screen's seventh
  row by 350ms. Never on a list the reader opened to reach one specific row.
- **Height.** A height may animate in two cases: a block **arriving or
  folding at or below the reading point**, and a frame whose content was
  **swapped in place** where the reader is looking. Each has a sanctioned
  primitive, on `motionDeliberateEntrance` unless named otherwise, clipped
  only while it moves, and **instant under reduced motion** (`useMotionToken`,
  because `<MotionConfig reducedMotion="user">` does not cover height or
  opacity):
  - `HeightArrival` (`components/motion`): a block that mounts below the
    prose (takeaways, an unplaced card, a late Projektbezug), height 0 to
    `auto` while it fades in; inside `AnimatePresence initial={false}` so a
    stored block stands at once.
  - `HeightExpand`: a block that stays mounted and opens or closes (the answer
    footer); `instant` where nobody can see it.
  - `useHeightGlide(frameRef, swapKey)`: one content replaced by another in
    the same frame, on `motionBase`. A proposal card's decision becoming its
    one-line receipt (the decision fades out, the height glides while it is
    invisible, the receipt fades in), a tab strip switching panels, a diagram
    fence that fails to draw and shows its source. Keyed: any other size
    change lands at once.
  - `DrawingReveal` / `DrawingCaption` (`features/diagrams`): a drawing grows
    from its skeleton to its laid-out height, measured by a `ResizeObserver`
    once it stands still, and its caption arrives on the same step.
  - `CardSlot` (`CardSlotArrival.tsx`): a card slot growing into its card, or
    a held place folding away when the card never comes.
  - Radix Collapsible, for an accordion the reader opened.

  Never in the same frame as a large commit (the settle of a streamed answer,
  a new turn mounting). A block above the reading point never animates its
  height: it moves the text the reader is on. Anything else that must change
  size while visible **fades first, then changes height in one frame while
  invisible** (a masthead gated out, the Herleitung's fold). Any other
  `height` in a motion target carries an
  `eslint-disable-next-line grid/motion-vocabulary -- <why>` above the element.
- **Disabled eases.** A control turning disabled or dimmed (`opacity-50`,
  a `BusyButton` blocked past its delay) tweens its opacity on
  `--motion-quick`: the primitives name `opacity` in their transition lists,
  so the state change reads as a change rather than a blink.
- **One press.** A `Button` or `TabsTrigger` dips on its own. Every other
  pressable (a citation chip, a copy link, a card row) composes `PRESSABLE`
  (`components/ui/press.ts`): colour, background, border, filter on
  `--motion-quick`, `active:scale-[0.98]` on `--motion-snap`, flat under
  reduced motion. **A transition list names `scale`, not `transform`.**
  Tailwind v4's `scale-*`, `translate-*` and `rotate-*` set the independent
  `scale` / `translate` / `rotate` properties, which a transition on
  `transform` does not cover: until 2026-10 every press in the app snapped
  while its comment said it eased. `grid/motion-vocabulary` flags a list that
  names `transform` beside one of those utilities; `transition-transform` lists
  all four. Its keyboard ring is `FOCUS_RING`
  (`components/ui/focus-ring`) with `outline-none`. The hand-rolled controls
  around an answer had drifted to four scales on two durations. Two
  exceptions, both from size, never from taste. A control under ~24px (a
  `Checkbox`, a `Radio`) takes `PRESSABLE_SMALL`: 0.95 on `--motion-snap`,
  because the press is budgeted in pixels like the springs, and 0.98 of a
  16px box is a third of a pixel. A row in an `ItemList` that is a link or a
  button presses by a tint one step past its hover, not by a scale: a
  full-width row that shrinks pulls its edges off the hairlines it shares. The
  `RaisedCard` dips to the same 0.98 on `springPress` and lifts 2px on
  `motionQuick`, both as `transform` strings on the compositor, and does
  neither under reduced motion. A checkbox tick and a radio dot land on
  `--motion-snap` (a fade and a 90% scale) as the box fills.
- **A loading `Button` holds still.** With a leading icon the spinner takes
  the icon's slot; with none it centres over the label, which turns
  transparent and keeps the width and the accessible name. A spinner inserted
  beside a bare label pushed the label sideways and widened the button.
  `BusyButton` is the choice when the label must stay readable.
- **Busy is not disabled.** A control that is working keeps its focus and its
  width: `aria-disabled` plus a guard in its handler, never `disabled`
  (Chrome blurs a focused button the moment it becomes disabled). Its labels
  sit stacked in one cell (`StackedLabel`), so „Ablegen" turning into „Wird
  abgelegt …" nudges nothing. The busy look appears only once the wait has
  lasted 150 ms (`useDelayedFlag`); below that the press is the feedback. A
  proposal card shows each row's verdict first and takes its decided state one
  `motionDeliberate` beat later, so the reader sees which file moved.
- **An icon swap springs its scale, never its opacity.** `iconSwapTransition`
  puts scale on `springSnap` and opacity on `motionQuick`; the leaving glyph
  goes on `motionQuickExit` (`iconSwapExitTransition`). Take the pair through
  `useIconSwapTransition()`, which makes both instant under reduced motion. A
  bare `transition={springSnap}` on an element that animates opacity springs
  the fade: about 500 ms, run by WAAPI as a `linear()` curve, and still played
  under reduced motion.
- **Send ↔ Stop is one button that morphs.** The composer's send control
  never swaps elements: the same `<button>` changes its job, label and glyph
  (arrow → square → arrow), so the press target and keyboard focus stay put.
  The glyph cross-fades under `AnimatePresence mode="popLayout"` on
  `useIconSwapTransition`; the press is the Button's own `active:scale` dip on
  `--motion-snap`. The square appears when the turn exists in the store and
  the arrow returns on the press, not on the server's acknowledgement. Escape
  stops the turn (`aria-keyshortcuts="Escape"`).
- **The streaming caret breathes, it does not blink.** It stands solid while
  words advance and breathes only once the reveal has stood still for 600 ms
  (`animate-caret-breathe`: opacity 1 → 0.35 → 1 on `--motion-ambient` and
  `--ease-cycle`, `motion-reduce:animate-none`, resting at full ink). It sits
  inside the text and takes no width
  ([streaming-chat-answer.md](streaming-chat-answer.md#the-reveal-is-paced-not-typed)).
- **The live Herleitung moves only its frontier edges.** While a turn is
  live, the connectors into the newest row are React Flow's built-in
  `animated` edges (the library's marching `dashdraw` dash); nothing else in the
  graph moves. Nodes, source cards and connectors simply appear, and a settled
  graph has no animated edge. The cost is accepted and bounded: one marching
  edge measured ~245 ms of main thread per second on a 4x throttled phone, so
  the flag is limited to the frontier edges and to live turns
  (`renderedEdges` in `ReasoningFlow.tsx`, preview `/dev/derivation?variant=live`).
- Hover: `transition-colors` on interactive rows and links; never transform on
  hover for dense UI. The raised card's lift is the documented exception, and it
  is a tween.
- **One ambient loop per phase.** Every loop (skeleton shimmer, typing dots,
  progress sweep, text shimmer, the caret breath) runs on `--motion-ambient`
  (or `-slow`) and `--ease-cycle`, and at most one of them is on screen at a
  time. The working chat turn is the one exception, on purpose: its
  Herleitung header spins and shimmers, the graph's frontier connectors march
  and a running step chip pulses, because people watch that panel to see the
  agent work (2026-10). While the answer streams the label stops shimmering and
  the caret is the text's one loop, pending citation pills muted and still;
  after the settle, none. At rest, only a skeleton. A spinner is a loop too: a state that repeats on rows (each attachment being scanned or filed) is a still glyph, and the one spinner is the surface's own line („Wird abgelegt …“). A stagger inside a loop belongs to its `@utility` and derives from
  the token (`animate-typing-dot` staggers its own siblings), never to an
  `[animation-delay:…]` at the call site.

### Binding constraints

- **Transform and opacity only.** Never animate `width`, `margin`,
  `padding`, `top/left/right/bottom`, `gap` or `grid-template-*`, and
  `height` only as the arrival/fold described under *Height* above. A panel
  that changes size sets its size in one pass and **translates** its content.
  A proportion that changes is a `scaleX` from its start edge, not a width or
  a `flex-grow` (`SegmentMeter`), and a band that sweeps across a surface is a
  translated layer, never an animated `background-position`, which repaints
  every frame (the skeleton shimmer, `ShimmerText`).
- **`prefers-reduced-motion` flattens everything.** `<MotionConfig
  reducedMotion="user">` covers only motion/react's transform and layout
  animations: opacity, colour and height still tween, and delays still hold.
  A motion transition with a delay, a height or a choreography step therefore
  goes through `useMotionToken(token)`, which returns `motionInstant` under
  reduced motion, and an icon swap through `useIconSwapTransition()`. The
  hook reads the media query synchronously, so the first client render is
  already right; `@/hooks/use-reduced-motion` is false until its mount effect. The global rule in `globals.css` clamps
  `animation-duration`, `transition-duration` **and the delays**. The
  delay is not optional: a staggered element that keeps its delay is simply
  invisible for that long, which is the opposite of what the reader asked for.
  Every animation still carries `motion-reduce:animate-none` and every non-hover
  transition `motion-reduce:transition-none`. (Hover `transition-colors` is
  exempt — a colour change on pointer intent is feedback, not motion.)
- **No chroma from motion.** Springs overshoot, and an overshooting colour lands
  outside its token — so colour never springs.

### Never

Numbers counting up. Shaking an error. Morphing a skeleton. Fading a focus ring.
Animating a citation, a legal basis, a § reference or a knowledge gap on its own.
More than one ambient loop on screen. `ease-linear`. `transition-all`.

## Domain-specific treatments

- **LegalBasisCard** = the product's proof-of-work. Treat as a first-class quotation: a distinct but quiet card on the card ground, the law/Richtlinie + article/§ in a header row (§ refs in `font-mono`, the law's chip carrying the provenance signal), the cited excerpt as an actual blockquote set with the `Quote` atom (italic, readable measure, no rule down its edge), and a plain-language summary. It should read like an authoritative citation, not a chat bubble. This used to prescribe a law-tinted left accent (`border-l-2 border-l-source-law/40`) and a muted `border-l` on the excerpt; both went on 2026-10-27, when the owner said he prefers boxes without side stripes (see **Emphasis without a stripe**).
- **Citations/sources** — numbered, verifiable, hover-to-preview where possible; every citation chip carries its provenance signal (icon + label + color); source filenames in the file corpus should feel traceable.
- **Knowledge gaps ("Lücke")** — missing knowledge is rendered honestly as a first-class source entry in the gray `--source-auto` family (gap icon + label + remediation hint), never hidden.
- **Deep-research progress** — legible over noisy: a calm task checklist as the primary signal; thinking/tools/files are secondary tabs. Progress should feel like watching a competent analyst work, not a log stream.
- **Project Brief** (overview) — the architect's owned context; reads like a concise fact sheet the agent works from, with clear "what Piloti still doesn't know" prompts.

## Do-not

- No gradients.
- No emojis anywhere in UI. Icons are lucide-react only.
- No hardcoded colors — tokens only, so dark mode is free. The exceptions are listed under *Weight, face and white*.
- No nested cards (card-inside-card). Flatten with borders/dividers/spacing.
- Avoid side stripes: a coloured or ruled bar down the left (inline-start) edge of a card, callout, quote, toast, peek, row or chip, for status or for emphasis, is discouraged. And no status tint across a whole card. Status is a 10px rounded swatch on the title line, or an icon and a word — see **Emphasis without a stripe**.
- No purple/generic-AI aesthetic. **Provenance signals are the only chroma** — no blue active states (actions and focus are ink app-wide), and a source color is never used outside its meaning or without its icon + label. No general accent token: one existed briefly and was withdrawn (see §"Accent pop" above). A control that wants to stand out wants contrast, not chroma.
- No touch size on a `md:` breakpoint, no reveal that only hover can open, no `touch-action` that takes the page scroll from a surface that does not own the gesture, no `vh`, no meaning carried only by a tooltip. See [Touch](#touch).
- No hand-written breakpoint width in JavaScript; ask `useIsMobile()` or pass a query from `hooks/use-is-mobile.ts`. See [Breakpoints](#breakpoints-four-axes-four-questions).

## The app rail

The rail inside a project (`app-sidebar.tsx`), its 64px icon rail, and its phone shapes (the top band, the tab bar, „Mehr", the project sheet) are built on Paper on a desk. `ui/components/shell/app-rail-material.spec.ts` holds the material by reading the files, `project-selector.spec.tsx` the selector; each exception there names its function.

**Why the version before (2026-11-06) failed.** Its rule was „the rail is the one grey band, what sits on it is white, and nothing on it is a box“. So the project selector, the one control that changes everything below it, was a 24px tile of initials beside a name wrapped on two lines with no box round them: a paragraph and a tile, not a press (the founder: „I really hate what the sidebar does to the project selector“). The current section was a fill with no edge, 1.08:1 off the band (now white with its edge, 1.13:1 since the desk is the brand's sunken surface; 1.18:1 on round 3's darker desk), and every other row was muted at weight 440, so nothing said where the reader was and the rows read as switched off. Both groups stood at the top under two competing heads (the project's two lines, the organisation's 12px name), and the lower 60% of a 900px band was empty grey. Next to Dateien, where a press has an edge, the open tab is a thumb and a sheet has a shadow, the rail was the one part of the screen with no material.

**What the rail is.** The desk beside the page. Two things on it are white: the project selector, which is a press, and where the reader is, which is a sheet. Everything else is ink on the desk.

- **The project selector is the rail's first control and the one press on it.** The kit's secondary press (`Button variant="secondary"`: white, the 12% edge, radius 6; principle 4) across the rail's column, 40px, right under the wordmark: the project's name at 14/600 on ONE line and the chevrons that say it opens. A name that does not fit loses its middle and keeps its end (`MiddleTruncate`: „Baufeld D12" is what tells sibling projects apart); it never wraps, and the whole name is the press's title and the open list's first row. It opens a list that hangs under it on its left edge, 288px: a search first, the three projects opened last, the rest, „Alle Projekte ansehen" as the last row; a row is a name, the current one at 600 with a check. One order with the phone's list (`project-list.ts`). The keyboard cursor starts on the first project that is not the current one.
- **Initials stand only where no name fits.** In the icon rail the selector is the same press as a 36px tile of the project's initials (`projectInitials`), with the name as its tooltip, and its list opens beside the rail. Beside a name (the expanded rail, the lists, the phone's selector) initials said nothing the name did not; `ProjectMark` is gone.
- **On a phone the selector is the first row of „Mehr“, not in the top band** (2026-11-10, the founder: „we might want to move the project selector to more on mobile“). The row is one press (white, the 12% edge, radius 6, 56px): the project's name at 16/600 on one line, cut in the middle, over „Projekt wechseln“ in muted 13px, the chevrons at its end. It turns the sheet into the project list (`PhoneProjectList`: the search, „Zuletzt geöffnet“, „Weitere Projekte“, „Alle Projekte ansehen“, 56px rows) with a way back to „Mehr“; the sheet opens on „Mehr“ every time. The list has this one door on a phone. Switching is done a few times a day and now sits under the thumb; as a 44px press in the top band it took 56px of every page at the place a thumb reaches worst.
- **No project name stands above a phone page** (2026-11-10). On a phone the project is named in „Mehr“ (the selector row) and nowhere else: not as a band, not as a crumb, not over the chat's pills. Three tries at the top failed the same way (a 44px press, then a quiet line with the search in a band, then a crumb over the title; the founder: „it still looks weird, on mobile lets remove it entirely“): whatever stood there was a small thing above the page that belonged to no part of it. Below `md` a page starts with its title at 16/24/600, under the screen's top inset (`ProjectSectionFrame`, through `PageHeader`'s `titleStart` and `titleEnd`). The title's line holds one way back at its start, where there is one (a page under the Übersicht goes back to it; an opened mail hands the header its own, to its list, through `ProjectSectionBack`, and hides its „← E-Mail-Eingang“ on a phone; Dateien's other places are tabs and have none), and the app's search at its end as a 44px target hanging into the line. Alle Dateien has its own search field under its tabs, so its title's line carries no second magnifier; Suche is listed in „Mehr“, where it is on every page. Dateien's crumb („Projekt › Dateien“) is the desk's alone (`max-md:hidden`). The shell draws nothing above a page that has a header but the top inset and the connection's line while the link is not fine; a bare flow (the Einrichtung), which has no header, keeps one 44px line of way back and search. The chat's toolbar starts with its pills, with the connection's line over them only while it speaks (`ChatConnectionLine`). „Mehr“ in the tab bar shows no mark for other projects: no count is fetched across projects, and a mark not driven by data is decoration.
- **Where the reader is, is a sheet on the desk.** The current section is `bg-sheet shadow-xs`: white with the 12% edge and the thumb's 1px shadow, its label at 600 and its glyph in ink, as the open tab on Dateien's track and the open mail in its list (current is white on the desk). It glides between rows (`railActivePillId`). The phone's tab bar inside a project is the rail on its side: the desk, with the same sheet behind the current tab's glyph.
- **The project's last chats stand under „Chat“** (2026-11-10: none of the pilot offices found the chat history; some thought there was none, because its one door was an unlabelled glyph in the chat's toolbar). Up to five (`RAIL_CHAT_LIMIT`), by last activity, each its title on one line cut at the end (the whole title its tooltip), at 13/20/500 muted, their text on the sections' labels (51px) so they hang under „Chat“ as its places, 32px rows (44 under a finger) 2px apart, the hover and the press one and two steps down the ladder. The open chat is the current place: the rail's one sheet glides to it, its title in ink at 600, and „Chat“ above it keeps its label at 600 and its glyph in ink, without the sheet (an ancestor of where the reader is, as a folder over an open file). „Alle Chats ›“ closes the list and opens the history sheet over the chat. A project with no chats shows nothing there: no empty list, no „Alle Chats“ to a sheet that would say „none“. The rows are the history sheet's own (`useSessionRows`, through `RailChatsSource`, `rail-chats.tsx`), so the two never disagree. **The icon rail lists none**: a 36px tile has no room for a title, a hover popover would be a hidden door again, and the chat's toolbar names its own door („Chats“, glyph and word at every width; on a phone the word under the glyph, 12px, so the title keeps its room). The toolbar's door is never a glyph alone (`ChatToolbar.spec.tsx`).
- **A row is ink.** 36px (44 under a finger), the label 14/20/500 in ink, the glyph 16px muted until the row is current. The pointer's fill is one step down the ladder from the desk (`bg-selected`), the press one more (`bg-pressed`); an open door (the Postfach docked beside the page) holds the picked grey, so open and current never share a look. Decided against the ink-only hover of the version before: on a label that is already ink it showed nothing.
- **Every other fill is one step down from its plane.** A count and the avatar's disc are the picked grey on the desk (`SHELL_COUNT`), the count on the current sheet the desk; on paper (the org header) the pointer is the desk and an open doorway the picked grey. No `bg-muted`, `bg-accent`, `bg-secondary` or `on-sunken` in the rail's files: a fill names its plane.
- **The project owns the top, the office and the person the foot.** Top: the wordmark (the way to all projects) with the fold control, the selector, the project's sections (Chat, Dateien, Übersicht, Automatisierung, the phone tab bar's order). Foot: the organisation's doorways (Büroablage, Suche, Postfach) under the organisation's name as a 12/16/500 muted label, then the connection row when there is one, then the person. Two owners at the band's two ends: neither reads as the other's, and the band is held at both. A label „Organisation" there was the user menu's word for the organisation's settings. Plattform, the organisation's settings and the switch to another organisation stay in the person's menu: they are doors a few people use a few times, not places of the office's daily work. Above a project there is still no rail (`OrgHeader`): a rail is earned by a project's sections.
- **No rule between its parts or along the page's edge, in either theme.** The groups are separated by space and their owners; the desk's step to the paper is the edge (1.08:1 in light, 1.16:1 in dark, where the desk is the lighter of the two). Above a project the tab bar is paper on paper, and its rule is the only edge between the page and the bar. A field keeps its edge (the switcher's search).
- **272px by default** (it was 236), 64px folded, dragged between 200 and 420. At 272 the selector holds 212px of name, which is „Wohnbau Seestadt Baufeld D12" whole; at 236 a name of twenty-two letters already lost its middle.
- **One left edge, one axis.** The wordmark, the selector's name, the section glyphs and the group label start at 24px; the avatar (24px) starts at 20 and centres on the glyphs' axis, x=32, where the icon rail centres every tile, so nothing moves sideways on a fold; labels and the person's name start at 51px. The sections start 12px under the selector. The fold control stays in the head and in view in both widths: at the end of the brand row expanded, under the mark in the icon rail. Focus is the app's one outline, drawn inside each row (`data-focus-inset`).
- **A sheet's edge is a ring outside it** (gotchas.md): the sections' scroll box keeps 1px of its own above and below its rows (`py-px`), and the icon rail's clipped header 1px under the selector's tile, or the edge is cut to its corners.
- **A status that is fine says nothing.** The connection shows only while it is interrupted or gone, as a row above the person on a desktop and a line in the top band on a phone (`ConnectionBand`): a glyph in its colour beside its words (RefreshCw in ochre, „Verbindung unterbrochen"; WifiOff in red, „Keine Verbindung"), never a dot. In the icon rail the glyph stands alone with its words as its tooltip. While the server does not answer, „Erneut versuchen" (the kit's secondary press, 32px, 44 under a finger) pings now (`requestConnectionCheck`); offline has no button. While connected the status region stays in the tree, visually hidden, so the change is announced.
- **Counts are muted.** The Postfach's count is the muted `CountPill` in the shell's chrome (`InboxBadge tone="muted"`), 12px ink figures. The one ink count left is a reply from the product team under „Mein Feedback" in the person's menu and in „Mehr" (`CountPill` „attention"), where the count is the call to act.
- **Type.** The selector's name 14/600 (16/600 in „Mehr“ on a phone); rows and the person 14/500, the current row 600; the group label and the tab bar's labels 12/500, the current tab 600; menus keep the app's 14px; the phone's sheet rows 15px. Nothing under 12px.
- **Keys.** A section's tooltip names its `g …` jump: beside the label in the icon rail, alone after a longer rest in the expanded rail.
- **Menus belong to their row.** The person's menu is as wide as the person's row and opens above it; in the icon rail it and the selector's list open beside the rail.
- **No phone drawer.** Below `md` the rail draws no band; the tab bar and „Mehr" carry the destinations, and „Mehr" the project selector. Suche is in „Mehr" too, since the chat and Alle Dateien have no search on their title's line. „Mehr" heads its groups with their owners (the project's name; the organisation's name; Konto).
