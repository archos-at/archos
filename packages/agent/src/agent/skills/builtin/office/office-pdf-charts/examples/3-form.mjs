import { readFile, writeFile } from "node:fs/promises";
import { PDFCheckBox, PDFDocument, PDFTextField } from "pdf-lib";

export default async function () {
  const pdf = await PDFDocument.load(await readFile("/workspace/in/Formular.pdf"));
  const form = pdf.getForm();
  const fields = form.getFields().map((field) => ({
    name: field.getName(),
    type: field instanceof PDFTextField ? "text" : field instanceof PDFCheckBox ? "checkbox" : field.constructor.name,
  }));
  const values = { bauvorhaben: "Wohnhaus Musterstraße 12", datum: "18.11.2026" };
  for (const [name, value] of Object.entries(values)) form.getTextField(name).setText(value);
  form.getCheckBox("baufuehrer").check();
  await writeFile("/workspace/Formular-ausgefuellt.pdf", await pdf.save());
  return { fields, filled: Object.keys(values).length + 1 };
}
