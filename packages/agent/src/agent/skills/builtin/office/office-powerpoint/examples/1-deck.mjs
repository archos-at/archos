import { writeFile } from "node:fs/promises";
import PptxGenJS from "pptxgenjs";

export default async function () {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.title = "Bauherrenbesprechung";

  const title = pptx.addSlide();
  title.addText("Bauherrenbesprechung 4", { x: 0.6, y: 1.8, w: 8.8, h: 1, fontSize: 32, bold: true, fontFace: "Arial" });
  title.addText("Wohnhaus Musterstraße 12 · 18.11.2026", { x: 0.6, y: 2.9, w: 8.8, h: 0.5, fontSize: 16, color: "555555", fontFace: "Arial" });

  const status = pptx.addSlide();
  status.addText("Offene Punkte", { x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 24, bold: true, fontFace: "Arial" });
  status.addText(
    [
      { text: "Fensterfarbe festlegen", options: { bullet: true } },
      { text: "Angebot Haustechnik prüfen", options: { bullet: true } },
      { text: "Termin Einreichung bestätigen", options: { bullet: true } },
    ],
    { x: 0.5, y: 1.1, w: 4.4, h: 2.5, fontSize: 16, fontFace: "Arial", valign: "top" },
  );
  status.addTable(
    [
      [{ text: "Kostengruppe", options: { bold: true, fill: { color: "D9D9D9" } } },
        { text: "EUR", options: { bold: true, fill: { color: "D9D9D9" }, align: "right" } }],
      ["Baukonstruktion", { text: "412.000", options: { align: "right" } }],
      ["Technik", { text: "138.500", options: { align: "right" } }],
    ],
    { x: 5.2, y: 1.1, w: 4.3, colW: [2.6, 1.7], fontSize: 14, fontFace: "Arial", border: { type: "solid", pt: 0.5, color: "999999" } },
  );
  status.addChart(
    pptx.ChartType.bar,
    [{ name: "Kosten", labels: ["KS", "KF", "KB"], values: [412000, 451000, 448500] }],
    {
      x: 0.5, y: 3.7, w: 9, h: 1.8, barDir: "col", valAxisMinVal: 0, valAxisLabelFormatCode: "#,##0",
      chartColors: ["4C6A92"], showLegend: false, showValue: true, dataLabelPosition: "outEnd", dataLabelFormatCode: "#,##0",
      catAxisLabelFontFace: "Arial", valAxisLabelFontFace: "Arial", dataLabelFontFace: "Arial",
    },
  );

  await writeFile("/workspace/Bauherrenbesprechung.pptx", await pptx.write({ outputType: "uint8array" }));
  return { file: "/workspace/Bauherrenbesprechung.pptx", slides: 2 };
}
