# Blog covers

Every blog post has a cover: one line drawing that says what the post claims, in the
language of a construction drawing. The covers are the Linie image family
([brand-basis.md](brand-basis.md#imagery-four-families)) in one fixed format, so the blog
reads as one series and a new post gets a cover that belongs to it.

A cover appears three times: on the post's card in the blog listing (the whole 3:2 canvas),
under the post's lead (the share band, 1200 × 630), and as the post's share image
(`og:image`, the same band rendered to PNG at build time). It is decorative: the title
beside it says what the post is about, so the drawing is hidden from assistive technology
and never carries information the text does not. It has no words, so one cover serves a post
and its translation.

The inline figures inside a post (`apps/website/src/components/figures/`) are a separate,
older format and stay as they are. A new explainer graphic draws with the pens below.

## The format

| What | Rule |
|---|---|
| Canvas | 1200 × 800 drawing units (3:2), `viewBox="0 0 1200 800"` |
| Module | 40 units. The frame draws the module grid. Main edges sit on a grid line or a half module (20) |
| Share band | `y` 85 to 715: what the post banner and the share image show. The card shows the whole canvas |
| Drawing field | `x` 80 to 1120, `y` 120 to 680. Nothing leaves it, so the band crops only grid |
| Motif | Centred in the field, at least 60 % of its height: a confident drawing, not an icon in a margin |
| Annotations | Axes, dimension chains, level marks and axis bubbles reach out of the motif towards the field's edge |

## The frame

`apps/website/src/lib/covers.ts` puts every drawing into the same frame, so no cover can
change what all of them share: the canvas, the ground (`--surface-sunken`), the module grid
(`--line`) and the hatch pattern. A cover file holds only its drawing.

## The pens

The pens are the line types of a construction drawing (ISO 128-2, ÖNORM A 6240), so an
architect reads them without a legend. Their widths are the brand's strokes in screen
pixels at every size (`vector-effect: non-scaling-stroke`): the drawing scales between the
card and the banner, the pens do not, as a plot keeps its pen widths at any scale.

| Class | Token | Line type | Draw with it |
|---|---|---|---|
| `cut` | `--ink`, `--stroke-strong` | Thick continuous | What the section cuts; the outline of the main object; the front sheet |
| `view` | `--ink`, `--stroke-hairline` | Thin continuous | Edges seen beyond, treads, glazing, text lines on a sheet, leaders, ticks |
| `hidden` | `--ink`, hairline, dashed 6/4 | Dashed | What is behind, missing or not yet there |
| `axis` | `--line-strong`, hairline, dash-dot | Dash-dot | Axes and centrelines |
| `dim` | `--line-strong`, hairline | Thin continuous, grey | Dimension lines and their extension lines, detail circles |

| Fill class | Token | Use |
|---|---|---|
| `paper` | `--surface` | A sheet, a surface lying on another: layers without a shadow |
| `hatch` | 45° hairlines in `--ink-faint` | A cut material (concrete, masonry, a slab) |
| `tone` | `--line` | A quiet second plane, rarely |
| `solid` | `--ink` | **What the post is about.** One element, or one family of small repeated ones (columns). Every cover has it |

A fill class combines with a pen: `class="paper cut"` is a sheet with a thick edge,
`class="cut hatch"` a cut wall.

## Composition

1. **One claim, one drawing.** Read the post and find the one thing it says. Draw that, as
   an architect would draw it: a plan, a section, a detail, an axonometry, a site plan, a
   structural grid, a stack of sheets.
2. **The solid element is the point.** The answer arriving at the bottom of the shaft, the
   post of the spiral stair, the thermal break in the detail. A reader who sees only the
   black shape should land on the post's subject.
3. **Drawing conventions, not pictograms.** Dimension ticks at 45°, empty axis bubbles,
   level triangles, walk lines with a start dot and an arrow, the soft-insulation zigzag,
   the break line. No icons; a screen pointer only where the post is about the screen.
4. **No words, no numbers.** Text would tie the cover to one language and to a font the
   share image does not have.
5. **Black on light only.** No colour, no gradient, no shadow, no perspective (axonometry
   is fine), no photograph. A generated image is not a cover; if one is ever used anywhere
   on the blog it carries the `AITag`.

## The covers

| Id | Posts (de, en) | Drawing | Solid |
|---|---|---|---|
| `welcome` | `willkommen`, `welcome` | Guidelines, a building code, project drawings and an office detail, scattered, each tied by a leader to one place | The place they meet |
| `lesson-loop` | `ein-system-das-aus-ihrem-frust-lernt`, `a-system-that-learns-from-your-frustration` | A spiral stair in plan: a loop that comes round one level higher; six cut treads for the loop's six steps | The post at its centre |
| `review-round` | `gemeinsam-am-dokument`, `working-on-a-document-together` (drafts) | A floor plan in review: an area marked round the shaft, a point in a room, two colleagues' pointers | The agent's own pointer |
| `six-questions` | `ki-im-architekturbuero`, `ai-in-architecture-firms` | A structural grid of six axes | The columns standing on them |
| `office-archive` | `wissen-aus-alten-projekten`, `knowledge-from-past-projects` | A stack of archived sheets; one is pulled out, showing a loggia slab through an insulated wall | The thermal break: the detail the office solved before |
| `answer-pipeline` | `so-arbeitet-der-workspace`, `how-the-workspace-works` | A section through six storeys with a shaft through all of them | The cabin arriving at the bottom: the answer |
| `general-models` | `chatgpt-baurecht`, `chatgpt-building-law` | A detail callout on a drawing, in front of its older editions, pointing at a sheet that does not exist | The callout |

## Drawing a new cover

1. Read the post and write its claim in one sentence. Choose the drawing type and the solid
   element before drawing anything.
2. Draw on squared paper or in any vector tool on a 1200 × 800 canvas with a 40-unit grid.
3. Write `apps/website/src/assets/covers/<id>.svg`: one `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800">`
   with `g`, `path`, `rect`, `circle`, `ellipse`, `line`, `polyline` and `polygon` only,
   styled by the classes above and nothing else (no `fill`, `stroke`, `style` or `id`
   attributes). A comment at the top says what it shows. The id is English kebab-case,
   named for the drawing or the post.
4. Set `cover: <id>` in the post's frontmatter and in its translation's.
5. Look at it: `bun run dev` in `apps/website`, then the blog listing and the post at 390 px
   and 1440 px wide. The card must read at 360 px wide; the banner must not look empty.
6. `bun test src/lib/covers.test.ts`, then `bun run build`, which renders the share image to
   `/media/covers/<id>.png`. Open that PNG once.

## What holds it

| Rule | Held by |
|---|---|
| Every post has a cover, and it exists | The content schema (`cover: z.enum(COVER_IDS)`, `src/content.config.ts`): the build fails |
| Only the shapes, attributes and classes above; the 1200 × 800 canvas; a solid element; one cover per post and its translation; no unused cover | `apps/website/src/lib/covers.test.ts` (`bun run test`) |
| Pens and fills come from the tokens | `css/covers.css` here, copied by `sync.mjs` (`--check` fails a stale copy); `scripts/check_brand_rules.mjs` fails a colour literal |
| Frame, grid and hatch are the same on every cover | `renderCover` in `apps/website/src/lib/covers.ts` draws them; a cover cannot |
| Composition: one claim, the solid is the point, conventions over pictograms | Review |
