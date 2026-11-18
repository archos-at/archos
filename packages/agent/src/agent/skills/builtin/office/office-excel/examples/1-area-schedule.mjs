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
