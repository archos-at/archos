# Post blocks: the contract with the CMS

The content components an editor can put into a blog post, beside the paragraphs: a chart,
key figures, a before/after comparison, an annotated image, a legal source, a question and
answer, key takeaways. Each is an Astro component in this folder, styled by the design
system's `packages/brand/css/blocks.css`, with a rules sheet in
`packages/brand/docs/components/<Name>.md`. All of them render on the server; only
`Compare` and `AnnotatedImage` carry a small script, and both work without it.

`contracts.ts` is the contract in code: one TypeScript type per block and one parser that turns
untrusted JSON into it. This file is the same contract for whoever registers the blocks in the
CMS (Payload, a Lexical `BlocksFeature`, ADR-0155). `contracts.test.ts` parses every example
below, so this file cannot drift from the code.

See them all with example content at `/blog-bausteine/` and `/en/blog-blocks/` (unlisted,
noindex).

## How a block gets from the CMS to the page

1. The CMS registers one block per row of the table below, with `slug` as the block's
   `blockType` and fields that produce exactly the JSON shown (Payload field names are the
   JSON keys).
2. The site's mapper reads the post's Lexical JSON and calls
   `parseContentBlock(blockType, fields)` from `contracts.ts`. `{ ok: true, value }` is ready
   for the component; `{ ok: false, issues }` is dropped, as an unknown block is, and the
   issues name the field and the rule (`chart: series „Büro A“ has 3 values for 4 labels`).
   An image field is an upload in the CMS; the mapper resolves it to a `BlockImage`
   (`src`, `width`, `height`, `alt`, optional `srcset` and `sizes`) through the CMS's transform
   presets before parsing, as PostBlocks does for an image block.
3. The renderer passes the value and the page's `locale` to the component:
   `<Chart locale={locale} {...value} />`. The components take nothing else.

The CMS should enforce the same limits in its field validation, so an editor sees the problem
while writing rather than a block that silently does not appear.

| `blockType` | Component | What it is for |
|---|---|---|
| `chart` | `Chart.astro` | Bars (grouped or stacked) or lines from a small table the editor types or pastes |
| `keyFigures` | `KeyFigures.astro` | Two to four numbers in a row, each with its source |
| `compare` | `Compare.astro` | Two states of the same drawing, a divider the reader moves |
| `annotatedImage` | `AnnotatedImage.astro` | An image with numbered markers and the explanations below |
| `legalSource` | `LegalSource.astro` | A norm or a law: passage, edition, wording, link |
| `qaExcerpt` | `QaExcerpt.astro` | A question and the product's answer with its sources |
| `keyTakeaways` | `KeyTakeaways.astro` | Three to five sentences at the top of a post |

Text fields are plain text: the components escape them. The one exception is
`qaExcerpt.answer`, which is Markdown rendered by `src/lib/markdown.ts` (raw HTML escaped).

## `chart`

| Field | Type | Rule |
|---|---|---|
| `form` | `'bar' \| 'line'` | required |
| `stacking` | `'grouped' \| 'stacked'` | bars with 2–3 series; default `grouped`; a stack takes no negative values |
| `title` | text | required, ≤ 120; the finding as a statement, ending with a full stop |
| `caption` | text | ≤ 240; what is measured, where, when |
| `unit` | text | ≤ 12; written after a value (`%`, `h`, `m²`, `Tage`) |
| `axisLabel` | text | ≤ 60; what the vertical axis measures, when the title does not say it |
| `decimals` | number | 0–2; default: as many as the data has |
| `startAtZero` | boolean | lines only; default `true`. Bars always start at zero |
| `labels` + `series` | text[] + `{ name, values: (number \| null)[] }[]` | 2–24 labels, 1–3 series, one value per label |
| `table` | text | instead of `labels` + `series`: the table as typed or pasted (below) |
| `source` | text | required, ≤ 200 (Belegpflicht) |
| `sourceUrl` | text | https only |

The friendliest field for an editor is `table`, a textarea: paste a range from a spreadsheet
(tab-separated), or type rows with `;`, or a Markdown table. The first row names the series,
the first column holds the labels. A decimal comma and a decimal point both work; a thousands
separator does not (`1.200` would be ambiguous): write `1200`. An empty cell or `–` is a
missing value.

```text
Planstand; Wohnbau Seestadt; Schule Floridsdorf
Vorentwurf; 4; 3
Entwurf; 6; 5
```

```json
{
  "blockType": "chart",
  "form": "bar",
  "title": "In der Ausführung entstehen die meisten Planstände.",
  "caption": "Planstände je Leistungsphase in zwei Projekten.",
  "table": "Leistungsphase; Wohnbau Seestadt; Schule Floridsdorf\nVorentwurf; 4; 3\nEntwurf; 6; 5\nEinreichung; 3; 4\nAusführung; 11; 9",
  "source": "Projektablage, Stand 30.09.2026"
}
```

## `keyFigures`

| Field | Type | Rule |
|---|---|---|
| `items` | `{ value, unit?, label, source? }[]` | 2–4 |
| `items[].value` | text | required, ≤ 8, with a digit; written as it is read (`3,5`, `1.284`) |
| `items[].unit` | text | ≤ 8 |
| `items[].label` | text | required, ≤ 60 |
| `items[].source` | text | ≤ 200; shown as a numbered note under the row; the same source text shares one number |

```json
{
  "blockType": "keyFigures",
  "items": [
    { "value": "3", "label": "Änderungen im Inneren", "source": "Planvergleich Rev. C mit Rev. D, Modul 1:25" },
    { "value": "0", "label": "Änderungen an Tragwerk und Fassade", "source": "Planvergleich Rev. C mit Rev. D, Modul 1:25" },
    { "value": "10", "label": "Protokolle und Mails gelesen", "source": "Projektablage, Stand 25.09." }
  ]
}
```

## `compare`

| Field | Type | Rule |
|---|---|---|
| `before`, `after` | `BlockImage` | required; the same aspect ratio (±1 %); alt text required |
| `beforeLabel`, `afterLabel` | text | required, ≤ 40: the names of the two states |
| `caption` | text | ≤ 240 |
| `start` | number | 0–100, where the divider starts; default 50 |

```json
{
  "blockType": "compare",
  "before": { "src": "https://cms.example.org/api/media/file/plan-rev-c.webp", "width": 2400, "height": 1500, "alt": "Grundriss des Wohnmoduls, Rev. C." },
  "after": { "src": "https://cms.example.org/api/media/file/plan-rev-d.webp", "width": 2400, "height": 1500, "alt": "Derselbe Grundriss in Rev. D, mit Einbauschrank am Eingang." },
  "beforeLabel": "Rev. C, 12.09.",
  "afterLabel": "Rev. D, 25.09.",
  "caption": "Wohnmodul im Grundriss, Rev. C vom 12.09. und Rev. D vom 25.09."
}
```

## `annotatedImage`

| Field | Type | Rule |
|---|---|---|
| `image` | `BlockImage` | required |
| `markers` | `{ x, y, title, text? }[]` | 1–9, numbered in this order |
| `markers[].x`, `.y` | number | 0–100: percent of the image's width and height from its top left corner |
| `markers[].title` | text | required, ≤ 80 |
| `markers[].text` | text | ≤ 280 |
| `caption` | text | ≤ 240 |

A marker editor in the CMS can be two number fields; a click-to-place field is a later comfort,
not a requirement.

```json
{
  "blockType": "annotatedImage",
  "image": { "src": "https://cms.example.org/api/media/file/plan-rev-d.webp", "width": 2400, "height": 1500, "alt": "Grundriss des Wohnmoduls in Rev. D mit drei Markierungen." },
  "markers": [
    { "x": 22.5, "y": 26, "title": "Arbeitsplatz in die Küchenzeile integriert", "text": "Wunsch der Bauherrschaft, Protokoll Nr. 12." },
    { "x": 80.3, "y": 74, "title": "Einbauschrank am Eingang ergänzt" }
  ],
  "caption": "Was sich in Rev. D geändert hat."
}
```

## `legalSource`

| Field | Type | Rule |
|---|---|---|
| `title` | text | required, ≤ 80: `OIB-Richtlinie 2.2`, `Wiener Bauordnung` |
| `section` | text | ≤ 60: `Punkt 5.1.1`, `§ 106 Abs. 2` |
| `version` | text | ≤ 60: `Ausgabe Mai 2023`, `Fassung vom 01.01.2025` |
| `issuer` | text | ≤ 100 |
| `excerpt` | text | ≤ 600, verbatim |
| `excerptLang` | `'de' \| 'en'` | the excerpt's language when it differs from the post's (a German law quoted in an English post) |
| `url` | text | https only: RIS, OIB |

```json
{
  "blockType": "legalSource",
  "title": "OIB-Richtlinie 3",
  "section": "Punkt 11.2.1",
  "version": "Ausgabe Mai 2023",
  "issuer": "Österreichisches Institut für Bautechnik",
  "excerpt": "Die lichte Raumhöhe von Aufenthaltsräumen muss mindestens 2,50 m betragen.",
  "excerptLang": "de",
  "url": "https://www.oib.or.at/"
}
```

## `qaExcerpt`

| Field | Type | Rule |
|---|---|---|
| `question` | text | required, ≤ 400 |
| `answer` | Markdown | required, ≤ 2000 |
| `sources` | `{ kind, title, detail? }[]` | 0–6, shown in order |
| `sources[].kind` | `building_law \| office \| project \| web \| measurement` | the agent's `SOURCE_KINDS` (`packages/agent/src/agent/common/source_kinds.py`) |
| `sources[].title` | text | required, ≤ 80 |
| `sources[].detail` | text | ≤ 40: `Punkt 3.2`, `S. 4` |
| `sourceCount` | whole number | ≥ the sources shown: „Abgeleitet aus 7 Quellen“ |
| `asker` | text | ≤ 80, a role and never a name: `Projektleiterin, Wohnbau in Wien` |
| `caption` | text | ≤ 240 |

```json
{
  "blockType": "qaExcerpt",
  "question": "Ist der Aufgang als Fluchtweg breit genug?",
  "asker": "Projektleiterin, Wohnbau in Wien",
  "answer": "**Ja, bis auf eine Stelle.** Im Grundriss 1:100 ist der Aufgang mit 1,30 m eingetragen.",
  "sources": [
    { "kind": "project", "title": "Brandschutzkonzept", "detail": "Punkt 4.2" },
    { "kind": "building_law", "title": "OIB-Richtlinie 2", "detail": "Punkt 5" }
  ],
  "sourceCount": 7
}
```

## `keyTakeaways`

| Field | Type | Rule |
|---|---|---|
| `title` | text | ≤ 60; default „Das Wichtigste in Kürze“ / „Key takeaways“ |
| `items` | text[] or `{ text }[]` | 3–5, each ≤ 200; Payload's array field gives rows with a `text` |

```json
{
  "blockType": "keyTakeaways",
  "items": [
    "Rev. D ändert drei Dinge im Inneren des Moduls.",
    "Tragwerk, Fassade und Modultrennwände sind gleich geblieben.",
    "Jede Änderung geht auf ein Protokoll, eine Mail oder das Raumprogramm zurück."
  ]
}
```
