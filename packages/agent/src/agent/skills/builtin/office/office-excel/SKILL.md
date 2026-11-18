---
name: office-excel
description: >
  Use when the person wants an Excel workbook (.xlsx) written or filled: a
  Flächenaufstellung, a Raumbuch, a cost table, a Planliste, the office's own
  Excel template; or wants the figures read out of one. Read `office-files`
  first for the run contract.
metadata:
  agents: researcher
  title: Excel-Tabelle erstellen
---

# An Excel workbook

`exceljs` writes, reads and fills workbooks. Read `office-files` first if you
have not this conversation.

## Writing a sheet

- Write numbers as numbers and dates as `Date`, never as formatted strings:
  Excel formats them in the reader's locale, so `#,##0.00` shows 1.234,56 on a
  German machine. Units go into the format: `'#,##0.00 "m²"'`, dates
  `"dd.mm.yyyy"` (make a date with `new Date(Date.UTC(y, m - 1, d))`). Every
  formula cell needs its own `numFmt` too; nothing infers it.
- Use formulas for totals and derived columns, so the sheet still adds up when
  someone changes an input. Put each input in its own labelled cell and refer to
  it (`=C5*$B$2`), never a number typed into a formula.
- Nothing here recalculates a workbook: Excel computes the formulas when it
  opens the file. So compute each formula's value in the run too, give it as
  the cell's `result` (`{ formula: "SUM(C2:C4)", result: total }`) for previews,
  and return it in `value` for your answer. Check that the range you wrote is
  the range you computed: an off-by-one range gives a clean file with a wrong
  number.
- Use functions every Excel has: `SUM`, `SUMIFS`, `ROUND`, `IF`, `IFERROR`,
  `INDEX`/`MATCH`. Not `XLOOKUP`, `FILTER`, `SORT`, `UNIQUE` or `SEQUENCE`:
  sort and filter in the run before writing. A sheet name with a space is
  quoted in a reference: `='Flächen EG'!C5`.
- `sheet.columns` sets header, key and width at once; style the header row,
  freeze it with `sheet.views = [{ state: "frozen", ySplit: 1 }]`, and give it an
  `autoFilter` over the data rows.
- Page setup for printing: `paperSize: 9` is A4, `fitToWidth: 1` with
  `fitToHeight: 0` fits the columns on one page width.
- One sheet per storey or per group when the person will read them separately;
  a sum row per sheet. A sheet someone else fills in gets a line saying which
  cells to fill.
- In a merged range write only the top-left cell.
- Save with `new Uint8Array(await workbook.xlsx.writeBuffer())`.

```js
import { writeFile } from "node:fs/promises";
import Decimal from "decimal.js";
import ExcelJS from "exceljs";

export default async function () {
  const rooms = [
    ["EG", "Wohnen", 32.4],
    ["EG", "Küche", 11.2],
    ["OG", "Zimmer 1", 14.85],
  ];
  const total = rooms.reduce((sum, row) => sum.plus(row[2]), new Decimal(0)).toNumber();

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Flächen", {
    pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  sheet.columns = [
    { header: "Geschoss", key: "storey", width: 12 },
    { header: "Raum", key: "room", width: 32 },
    { header: "Fläche", key: "area", width: 16, style: { numFmt: '#,##0.00 "m²"' } },
  ];
  sheet.addRows(rooms);

  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9D9D9" } };
  header.getCell(3).alignment = { horizontal: "right" };

  const last = rooms.length + 1;
  const sum = sheet.addRow(["", "Summe", { formula: `SUM(C2:C${last})`, result: total }]);
  sum.font = { bold: true };
  sum.getCell(3).border = { top: { style: "thin" } };

  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: { row: last, column: 3 } };

  await writeFile("/workspace/Flaechenaufstellung.xlsx", new Uint8Array(await workbook.xlsx.writeBuffer()));
  return { file: "/workspace/Flaechenaufstellung.xlsx", rows: rooms.length, total };
}
```

## Check it

Load the file in a second run and look at every row, the formats and the
formulas:

```js
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";

export default async function () {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await readFile("/workspace/Flaechenaufstellung.xlsx"));
  const sheet = workbook.getWorksheet("Flächen");
  const rows = [];
  sheet.eachRow((row, number) => rows.push([number, ...row.values.slice(1).map((v) => v?.formula ? `=${v.formula}` : v)]));
  const sumCell = sheet.getCell(`C${sheet.rowCount}`);
  return {
    sheets: workbook.worksheets.map((s) => s.name),
    rows,
    numFmt: sheet.getCell("C2").numFmt,
    frozen: sheet.views[0]?.state,
    sum: { formula: sumCell.formula, cached: sumCell.result },
  };
}
```

The same `workbook.xlsx.load` reads a workbook the person sent: name it in
`documents` and read it from `/workspace/in/`. A formula cell of a workbook
Excel saved carries Excel's last result in `result`; one written by a program
may carry none.

## The office's template

Pass the template in `documents`, load it, fill the cells, and save under a new
name. Its conventions win over everything above: find the rows or cells it
leaves for input (read it first with the check above, on
`/workspace/in/<template>`), write only there, and leave its formulas, styles
and widths as they are. `exceljs` drops charts, pivot tables, text boxes and
form controls from a workbook it saves: if the template has them, say so
instead of returning a file that silently lost them.

```js
import { readFile, writeFile } from "node:fs/promises";
import ExcelJS from "exceljs";

export default async function () {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await readFile("/workspace/in/Vorlage-Planliste.xlsx"));
  const sheet = workbook.worksheets[0];
  const entries = [
    ["A-101", "Grundriss EG", "C", new Date(Date.UTC(2026, 10, 12))],
    ["A-102", "Grundriss OG", "B", new Date(Date.UTC(2026, 10, 3))],
  ];
  const first = 5;
  entries.forEach((entry, index) => {
    const row = sheet.getRow(first + index);
    row.values = entry;
    row.getCell(4).numFmt = "dd.mm.yyyy";
    row.commit();
  });
  await writeFile("/workspace/Planliste.xlsx", new Uint8Array(await workbook.xlsx.writeBuffer()));
  return { sheet: sheet.name, filled: entries.length, from: first, to: first + entries.length - 1 };
}
```
