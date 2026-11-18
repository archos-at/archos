---
name: office-word
description: >
  Use when the person wants a Word document (.docx): an Aktenvermerk, a
  Baubeschreibung, a letter, a report with tables, or the office's own Word
  template filled in; or wants the text of a .docx read. Read `office-files`
  first for the run contract.
metadata:
  agents: researcher
  title: Word-Dokument erstellen
---

# A Word document

A .docx is a ZIP of XML parts. `docx` builds a new one; `jszip` opens an
existing one and changes its XML. Read `office-files` first if you have not
this conversation.

## A new document with `docx`

- Lengths are twips: 1 cm = 567. The default page is A4
  (`{ width: 11906, height: 16838 }`); for landscape pass the same portrait
  size with `orientation: PageOrientation.LANDSCAPE`.
- Margins of 2,5 cm left and 2 cm right are `left: 1418, right: 1134`.
- A table needs `columnWidths` on the table and the same `width` on each cell,
  both in `WidthType.DXA`, and the columns sum to the table width: Word reads
  the cells, other programs the columns. `tableHeader: true` repeats the header
  row on every page.
- Shade a cell with `ShadingType.CLEAR` and a `fill`; `SOLID` turns it black.
- Every new line is its own `Paragraph`; `\n` in a text does nothing. A page
  break is a `PageBreak` inside a `Paragraph`.
- Lists come from a `numbering` config with `LevelFormat.BULLET` or
  `LevelFormat.DECIMAL`; never type a `•` into the text.
- Headings with `HeadingLevel.HEADING_1` … so the document has an outline, and
  each level you use styled in `styles.default` (`heading1`, `heading2`) with
  its font, spacing and `keepNext: true`: the built-in ones keep nothing with
  the next line. The body font goes in `styles.default.document.run`; `size` is
  in half points (20 = 10 pt).
- Page numbers: a `TextRun` with `children: ["Seite ", PageNumber.CURRENT, " von ", PageNumber.TOTAL_PAGES]`
  in the footer.
- A rule under a line is the paragraph's bottom `border`, not a table.
- m² can be the character ² or a run with `superScript: true`.
- Save with `await Packer.toBuffer(doc)`.

```js
import { writeFile } from "node:fs/promises";
import Decimal from "decimal.js";
import {
  AlignmentType, Document, Footer, Header, HeadingLevel, LevelFormat, Packer, PageNumber,
  Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
} from "docx";

const area = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

const COLUMNS = [1400, 5154, 2800];

function cell(text, width, { header = false, right = false } = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: header ? { type: ShadingType.CLEAR, fill: "D9D9D9", color: "auto" } : undefined,
    children: [new Paragraph({
      alignment: right ? AlignmentType.RIGHT : AlignmentType.LEFT,
      children: [new TextRun({ text, bold: header })],
    })],
  });
}

export default async function () {
  const rooms = [
    { storey: "EG", name: "Wohnen", area: 32.4 },
    { storey: "EG", name: "Küche", area: 11.2 },
    { storey: "OG", name: "Zimmer 1", area: 14.85 },
  ];
  const total = rooms.reduce((sum, room) => sum.plus(room.area), new Decimal(0)).toNumber();

  const table = new Table({
    width: { size: COLUMNS.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: COLUMNS,
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          cell("Geschoss", COLUMNS[0], { header: true }),
          cell("Raum", COLUMNS[1], { header: true }),
          cell("Fläche m²", COLUMNS[2], { header: true, right: true }),
        ],
      }),
      ...rooms.map((room) => new TableRow({
        children: [
          cell(room.storey, COLUMNS[0]),
          cell(room.name, COLUMNS[1]),
          cell(area.format(room.area), COLUMNS[2], { right: true }),
        ],
      })),
      new TableRow({
        children: [
          cell("", COLUMNS[0]),
          cell("Summe", COLUMNS[1], { header: true }),
          cell(area.format(total), COLUMNS[2], { header: true, right: true }),
        ],
      }),
    ],
  });

  const doc = new Document({
    creator: "Office",
    title: "Aktenvermerk",
    styles: {
      default: {
        document: { run: { font: "Arial", size: 20 } },
        heading1: { run: { font: "Arial", size: 28, bold: true, color: "000000" }, paragraph: { spacing: { before: 240, after: 120 }, keepNext: true } },
        heading2: { run: { font: "Arial", size: 22, bold: true, color: "000000" }, paragraph: { spacing: { before: 200, after: 80 }, keepNext: true } },
      },
    },
    numbering: {
      config: [{
        reference: "bullets",
        levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 260 } } } }],
      }],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1418, bottom: 1134, left: 1418, right: 1134, header: 709, footer: 709 },
        },
      },
      headers: {
        default: new Header({ children: [new Paragraph({ children: [new TextRun("Projekt Musterstraße 12")] })] }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ children: ["Seite ", PageNumber.CURRENT, " von ", PageNumber.TOTAL_PAGES] })],
          })],
        }),
      },
      children: [
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Aktenvermerk")] }),
        new Paragraph({ children: [new TextRun(`Datum: ${date.format(new Date(2026, 10, 18))}`)] }),
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Flächen")] }),
        new Paragraph({
          spacing: { after: 120 },
          children: [
            new TextRun("Die Nutzfläche beträgt "),
            new TextRun({ text: `${area.format(total)} m`, bold: true }),
            new TextRun({ text: "2", bold: true, superScript: true }),
            new TextRun("."),
          ],
        }),
        table,
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Nächste Schritte")] }),
        ...["Fensterfarbe mit der Bauherrschaft festlegen", "Flächen nach dem nächsten Stand prüfen"].map(
          (text) => new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun(text)] }),
        ),
      ],
    }],
  });

  await writeFile("/workspace/Aktenvermerk.docx", await Packer.toBuffer(doc));
  return { file: "/workspace/Aktenvermerk.docx", rooms, total };
}
```

## Check it

Read the text back with `jszip` and compare it with what you meant to write:

```js
import { readFile } from "node:fs/promises";
import JSZip from "jszip";

export default async function () {
  const zip = await JSZip.loadAsync(await readFile("/workspace/Aktenvermerk.docx"));
  const xml = await zip.file("word/document.xml").async("string");
  const paragraphs = xml
    .split("</w:p>")
    .map((p) => p.replace(/<w:tab\/>/g, "\t").replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&"))
    .filter((text) => text.trim());
  return {
    parts: Object.keys(zip.files).filter((name) => /^word\/(header|footer)\d*\.xml$/.test(name)),
    paragraphs: paragraphs.slice(0, 40),
    tables: (xml.match(/<w:tbl>/g) ?? []).length,
    placeholdersLeft: paragraphs.join("\n").match(/\{\{[A-Z_]+\}\}/g) ?? [],
  };
}
```

## The office's template

`docx` cannot open an existing .docx. Pass the template in `documents` and
replace its placeholders in the XML with `jszip`:

- The text is in `word/document.xml`, the letterhead in `word/header1.xml` …,
  the footer in `word/footer1.xml` …; go through all of them.
- Word splits text into runs where formatting, spell checking or revisions
  changed, so a placeholder such as `{{DATUM}}` is often not one string in the
  XML (`{{DA</w:t></w:r><w:r><w:t>TUM}}`). Match it with XML tags allowed
  between its characters, as below, and replace the whole match.
- Change only the text. Leave the rest of the XML byte for byte as it was, and
  escape `&`, `<`, `>` and `"` in the values.
- Not sure what the placeholders are called? Read the template's text first
  (the check above, on `/workspace/in/<template>`); if it has none, ask.
- Return which placeholders were replaced and which are left, and say in the
  answer if one is left.

```js
import { readFile, writeFile } from "node:fs/promises";
import JSZip from "jszip";

const escapeXml = (text) =>
  String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const PLACEHOLDER = /\{(?:<[^>]+>)*\{((?:[A-Z_]|<[^>]+>)+)\}(?:<[^>]+>)*\}/g;

export default async function () {
  const values = {
    PROJEKT: "Wohnhaus Musterstraße 12",
    DATUM: "18.11.2026",
    BETREFF: "Abstimmung Fassade & Fenster",
  };
  const zip = await JSZip.loadAsync(await readFile("/workspace/in/Briefpapier.docx"));
  const parts = Object.keys(zip.files).filter((name) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(name));
  const replaced = {};
  for (const name of parts) {
    let xml = await zip.file(name).async("string");
    xml = xml.replace(PLACEHOLDER, (match, inner) => {
      const key = inner.replace(/<[^>]+>/g, "");
      if (!(key in values)) return match;
      replaced[key] = (replaced[key] ?? 0) + 1;
      return escapeXml(values[key]);
    });
    zip.file(name, xml);
  }
  const left = [];
  for (const name of parts) {
    const text = (await zip.file(name).async("string")).replace(/<[^>]+>/g, "");
    left.push(...(text.match(/\{\{[A-Z_]+\}\}/g) ?? []));
  }
  await writeFile("/workspace/Aktenvermerk.docx", await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
  return { replaced, left };
}
```

A chart cannot go into a Word file from a run: Word needs a PNG beside the SVG,
and nothing here draws one. Make the chart as its own SVG file
(`office-pdf-charts`) and say so.
