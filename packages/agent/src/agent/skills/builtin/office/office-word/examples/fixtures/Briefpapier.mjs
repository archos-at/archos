import { writeFile } from "node:fs/promises";
import { Document, Header, Packer, Paragraph, TextRun } from "docx";

export default async function () {
  const doc = new Document({
    sections: [{
      headers: { default: new Header({ children: [new Paragraph({ children: [new TextRun("Projekt: {{PROJEKT}}")] })] }) },
      children: [
        new Paragraph({ children: [new TextRun("Datum: {{DA"), new TextRun({ text: "TUM}}", bold: true })] }),
        new Paragraph({ children: [new TextRun("Betreff: {{BETREFF}}")] }),
      ],
    }],
  });
  await writeFile("/workspace/Briefpapier.docx", await Packer.toBuffer(doc));
}
