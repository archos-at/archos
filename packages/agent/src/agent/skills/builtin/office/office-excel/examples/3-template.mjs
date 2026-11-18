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
