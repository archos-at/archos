import { writeFile } from "node:fs/promises";
import { Document, Page, Text, Table, Row, Cell, Fixed, h, renderDocument } from "forme";

const cell = (text, style) => h(Cell, { style: { padding: 4, ...style } }, h(Text, null, text));

export default async function () {
  const rows = [["A-101", "Grundriss EG", "C"], ["A-102", "Grundriss OG", "B"]];
  const doc = h(Document, null,
    h(Page, { size: "A4", margin: 48 },
      h(Fixed, { position: "header" }, h(Text, { style: { fontSize: 8, color: "#555" } }, "Büro – Wohnhaus Lindengasse")),
      h(Fixed, { position: "footer" }, h(Text, { style: { fontSize: 8, textAlign: "right" } }, "Seite {{pageNumber}} von {{totalPages}}")),
      h(Text, { style: { fontSize: 18, fontWeight: "bold", marginBottom: 8 } }, "Planliste"),
      h(Table, { columns: [{ width: { fraction: 0.2 } }, { width: { fraction: 0.65 } }, { width: { fraction: 0.15 } }] },
        h(Row, { header: true, style: { backgroundColor: "#e6e6e6" } }, cell("Nummer"), cell("Inhalt"), cell("Index")),
        ...rows.map((row) => h(Row, null, ...row.map((value) => cell(value)))))));
  await writeFile("/workspace/Planliste.pdf", await renderDocument(doc));
}
