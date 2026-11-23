import { writeFile } from "node:fs/promises";
import PptxGenJS from "pptxgenjs";
import { houseDeck } from "house-style";

export default async function () {
  const pptx = new PptxGenJS();
  pptx.title = "Bauherrenbesprechung 4";
  const deck = houseDeck(pptx, { footer: "Wohnhaus Musterstraße 12 · Bauherrenbesprechung 4" });

  deck.cover({
    title: "Bauherrenbesprechung 4",
    subtitle: "Kosten, offene Entscheidungen, nächste Termine",
    meta: "Wohnhaus Musterstraße 12 · 18.11.2026",
  });

  const decisions = deck.slide("Drei Entscheidungen brauchen wir heute");
  decisions.addText(
    deck.bullets(["Fensterfarbe: Anthrazit oder Eiche", "Angebot Haustechnik annehmen", "Einreichung am 05.12.2026 bestätigen"]),
    deck.text("left"),
  );
  decisions.addTable(
    deck.table(
      [["Kostengruppe", "EUR"], ["Baukonstruktion", "412.000"], ["Technik", "138.500"], ["Summe", "550.500"]],
      { numeric: [1], total: true },
    ),
    deck.tableOptions("right", { colW: [2.6, 1.6] }),
  );

  deck.section("Kosten");

  const costs = deck.slide("Die Kostenschätzung liegt 9 % über dem Budget");
  costs.addChart(
    pptx.ChartType.bar,
    [{ name: "Kosten", labels: ["Budget", "Kostenschätzung", "Kostenberechnung"], values: [412000, 451000, 448500] }],
    deck.chart("wide", { barDir: "col", valAxisLabelFormatCode: "#,##0", showValue: true, dataLabelPosition: "outEnd", dataLabelFormatCode: "#,##0" }),
  );
  costs.addText("Mehrkosten vor allem aus der Haustechnik (+ 31.000 EUR) und der Fassade (+ 8.000 EUR).", deck.text("aside", { fontSize: 14 }));
  costs.addNotes("Haustechnik: Wärmepumpe statt Gastherme, vom Bauherrn gewünscht.");

  await writeFile("/workspace/Bauherrenbesprechung.pptx", await pptx.write({ outputType: "uint8array" }));
  return { file: "/workspace/Bauherrenbesprechung.pptx", slides: 4 };
}
