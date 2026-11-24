import { writeFile } from "node:fs/promises";
import ExcelJS from "exceljs";

export default async function () {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Planliste");
  ws.getCell("A1").value = "Planliste";
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.getRow(4).values = ["Nummer", "Inhalt", "Index", "Datum"];
  ws.getRow(4).font = { bold: true };
  await writeFile("/workspace/Vorlage-Planliste.xlsx", new Uint8Array(await wb.xlsx.writeBuffer()));
}
