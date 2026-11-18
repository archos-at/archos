---
name: office-files
description: >
  Use before the first `execute` call, whenever the person wants a real file
  (Word, Excel, PowerPoint, PDF, a chart) or a figure that has to be computed
  rather than estimated: a Flächenaufstellung, an Aktenvermerk, a deck, a total.
  The run contract, the libraries, the office's conventions, how to check a file.
metadata:
  agents: researcher
  title: Dateien erstellen
---

# Files the office opens without explanation

`execute` runs a JavaScript module you write in a fresh sandbox and keeps the
files it writes. A file is done when the person can open it, read it and work
on with it, and every figure in it is one a run computed.

## The run

- `code` is an ES module whose default export does the work:
  `export default async function () { … }`. What it returns comes back as
  `value` (JSON). Nothing is passed in: write the data into the code as
  constants, or read it from a file.
- Return plain JSON only: an array with a hole or `undefined` in it, a `Date`
  or a `Decimal` fails the whole run. Turn dates into strings and decimals
  into numbers; `JSON.parse(JSON.stringify(value))` does both.
- Read and write files only inside that function, with `node:fs/promises`
  (`readFile`, `writeFile`, `readdir`). I/O at module scope fails ("can't run at
  module scope", or "Disallowed operation called within global scope").
- `/workspace/` is the working directory. Write each file directly into it,
  `/workspace/<Name>.<ext>`: it is kept, appears in the chat, and is
  `/drafts/<Name>.<ext>` outside the run. Files from earlier runs of this
  conversation are there again. To change one, load it, change it and write it
  back to the same path, so the person has one current file; a new name only
  when they want both versions.
- A document named in `documents` is at `/workspace/in/<file name>`, read-only;
  a second document of the same name is at `<name> (2).<ext>`, and the report's
  `documents read:` line names every path. Anything written under
  `/workspace/in/` is dropped, and the report says so: write a changed copy to
  `/workspace/<Name>.<ext>`.
- No network, no `fetch`, no npm, no shell, no Python, no LibreOffice: only the
  libraries below. TypeScript types are stripped, so plain JavaScript and
  TypeScript both run.
- `writeFile` takes a string, a `Uint8Array` or a `Buffer`.
- `console.log` comes back on stdout, a thrown error on stderr. A run stops
  after 60 seconds, and a conversation's runs go one at a time.

## The libraries

Import each by its npm name. Read the skill named here before the first run
that writes or reads that kind of file, even when you know the library: it
lists the mistakes that make Office refuse or repair a file, and its example
is the code to start from.

| Import | For | Skill |
|---|---|---|
| `docx` 9.15 | Word documents, new | `office-word` |
| `jszip` 3.10 | the XML parts inside an Office file: fill a Word template, read a .docx or .pptx | `office-word` |
| `exceljs` 4.4 | Excel: write, read back, fill a template | `office-excel` |
| `pptxgenjs` 4.0 | PowerPoint: slides, tables, native charts | `office-powerpoint` |
| `typst` 0.14 | PDF that reads like a document: tables, header and footer, flowcharts, Gantt, sequence diagrams | `office-pdf` |
| `forme` 0.31 | a one-page PDF table or list from data | `office-pdf` |
| `pdf-lib` 1.17 | PDF: merge, split, fill form fields | `office-pdf-charts` |
| `unpdf` 2.1 | the text of a PDF | `office-pdf-charts` |
| `vega` 6.4, `vega-lite` 6.5, `vega-interpreter` 2.3 | charts as SVG | `office-pdf-charts` |
| `@cloudflare/puppeteer` 2.0 | HTML and CSS to a designed PDF, Mermaid diagrams, PNG screenshots | `office-html-pdf` |
| `decimal.js` 10.6 | exact decimals: areas, money | this one |
| `mathjs` 15.2 | units, matrices, expressions | this one |
| `papaparse` 5.7 | CSV in and out: `delimiter: ";"`, and `"\uFEFF"` before the text so Excel reads umlauts | |
| `date-fns` 4.4 | date arithmetic: deadlines, working days | |
| `marked` 18.1 | Markdown to HTML | |

## The office's conventions

- A4 portrait unless asked otherwise. Arial throughout unless the office's
  template says otherwise.
- Numbers as the office writes them, 1.234,56:
  `new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })`.
  Take `de-DE`: other German locales group thousands with a narrow space.
- Dates as dd.mm.yyyy:
  `new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })`.
- Areas in m², volumes in m³. The characters ² and ³ work in every library,
  the PDF standard fonts included.
- The document's own name as the office uses it (Aktenvermerk, Raumbuch,
  Flächenaufstellung, Planliste), in the title and the file name. Text in the
  file is in the language of the person's message.
- Follow what the person specified literally: the sheet names, the column
  headings, the order they gave. Where you assumed a figure, write the
  assumption into the file where the reader sees it.

## Calculations

Compute in code, never in your head. Sum areas and money with `decimal.js`
(`0.1 + 0.2` is not `0.3` in floating point). Return every input and every
intermediate result in `value`, so the answer can show the Herleitung, and round
only for display, at the very end.

```js
import Decimal from "decimal.js";

export default function () {
  const site = new Decimal("812.40");
  const storeys = [
    { storey: "EG", gross: new Decimal("198.35") },
    { storey: "OG", gross: new Decimal("198.35") },
    { storey: "DG", gross: new Decimal("142.80") },
  ];
  const grossTotal = storeys.reduce((sum, s) => sum.plus(s.gross), new Decimal(0));
  const ratio = grossTotal.dividedBy(site);
  return {
    inputs: { site: site.toNumber(), storeys: storeys.map((s) => ({ storey: s.storey, gross: s.gross.toNumber() })) },
    steps: [
      { what: "gross floor area", formula: storeys.map((s) => s.gross.toString()).join(" + "), value: grossTotal.toNumber() },
      { what: "floor area ratio", formula: `${grossTotal} / ${site}`, value: ratio.toNumber() },
    ],
    result: { grossTotal: grossTotal.toNumber(), ratio: ratio.toDecimalPlaces(2).toNumber() },
  };
}
```

## Check what you made

Nothing here renders a page to look at, so check the content instead:

1. After writing a file, read it back in a second run (each file type's skill
   shows how) and compare it with the `value` of the run that wrote it: every
   heading, every row, every total.
2. Search what you read back for leftovers: `{{`, `xxx`, `lorem`, `TODO`, an
   empty cell where a figure belongs.
3. On an error, fix the code and run again. At most three runs per file; after
   the third failure, stop and tell the person what failed and what you have.

## After the file is made

- Say in one sentence what you made: its name, what is in it, the figure that
  matters. The file is shown in the chat, where the person can open it; do not
  repeat its content.
- File it into the project with `file_draft` (`/drafts/<Name>.<ext>`) only
  when the person asks. It takes .docx, .xlsx, .pptx, .pdf, .svg and .png.
- A figure in the file that came from a document keeps its citation in your
  answer. The file is your work, never a source.

## The office's template

When the person names a template (the Briefpapier, a Vorlage .docx or .xlsx in
the project), pass it in `documents` and fill it instead of building the file
from nothing, and keep its fonts, styles and layout exactly. `docx` cannot open
an existing file: fill a Word template with `jszip` (`office-word`), an Excel
template with `exceljs` (`office-excel`).
