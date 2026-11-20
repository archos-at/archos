import { writeFile } from "node:fs/promises";
import { PDFDocument, StandardFonts } from "pdf-lib";

export default async function () {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595.28, 841.89]);
  const form = pdf.getForm();
  page.drawText("Bauvorhaben", { x: 56, y: 760, size: 10, font });
  form.createTextField("bauvorhaben").addToPage(page, { x: 160, y: 752, width: 360, height: 20 });
  page.drawText("Datum", { x: 56, y: 720, size: 10, font });
  form.createTextField("datum").addToPage(page, { x: 160, y: 712, width: 120, height: 20 });
  page.drawText("Bauführer bestellt", { x: 56, y: 680, size: 10, font });
  form.createCheckBox("baufuehrer").addToPage(page, { x: 160, y: 676, width: 14, height: 14 });
  await writeFile("/workspace/Formular.pdf", await pdf.save());
}
