import { writeFile } from "node:fs/promises";
import * as vega from "vega";
import * as vegaLite from "vega-lite";
import { expressionInterpreter } from "vega-interpreter";

export default async function () {
  const values = [
    { stage: "Kostenschätzung", eur: 412000 },
    { stage: "Kostenberechnung", eur: 451000 },
    { stage: "Kostenanschlag", eur: 448500 },
  ];
  const spec = vegaLite.compile({
    width: 420,
    height: 240,
    config: { font: "Arial", locale: { number: { decimal: ",", thousands: ".", grouping: [3], currency: ["", " €"] } } },
    data: { values },
    mark: { type: "bar", color: "#4C6A92" },
    encoding: {
      x: { field: "stage", type: "nominal", sort: null, title: null, axis: { labelAngle: 0 } },
      y: { field: "eur", type: "quantitative", title: "EUR netto", axis: { format: ",.0f" } },
    },
  }).spec;
  const view = new vega.View(vega.parse(spec, null, { ast: true }), { expr: expressionInterpreter, renderer: "none" });
  const svg = await view.toSVG();
  await view.finalize();
  await writeFile("/workspace/Kostenentwicklung.svg", svg);
  return { file: "/workspace/Kostenentwicklung.svg", bytes: svg.length, values };
}
