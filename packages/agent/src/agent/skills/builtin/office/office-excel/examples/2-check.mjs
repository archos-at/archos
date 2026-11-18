import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";

const cell = (v) =>
  v instanceof Date ? v.toISOString().slice(0, 10)
    : v?.formula ? `=${v.formula}`
    : v?.richText ? v.richText.map((part) => part.text).join("")
    : v ?? null;

export default async function () {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await readFile("/workspace/Flaechenaufstellung.xlsx"));
  const sheet = workbook.getWorksheet("Flächen");
  const rows = [];
  sheet.eachRow((row, number) => rows.push([number, ...Array.from(row.values.slice(1), cell)]));
  const sumCell = sheet.getCell(`C${sheet.rowCount}`);
  return {
    sheets: workbook.worksheets.map((s) => s.name),
    rows,
    numFmt: sheet.getCell("C2").numFmt,
    frozen: sheet.views[0]?.state,
    sum: { formula: sumCell.formula, cached: sumCell.result },
  };
}
