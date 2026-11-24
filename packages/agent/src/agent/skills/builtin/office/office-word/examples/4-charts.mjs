import { writeFile } from "node:fs/promises";
import puppeteer from "@cloudflare/puppeteer";
import { Document, HeadingLevel, ImageRun, Packer, Paragraph, TextRun } from "docx";
import * as vega from "vega";
import * as vegaLite from "vega-lite";
import { expressionInterpreter } from "vega-interpreter";
import { docxPage, docxStyles, vegaLiteConfig } from "house-style";

const charts = [
  { title: "Kosten je Phase", note: "EUR netto", values: [["Schätzung", 412000], ["Berechnung", 451000], ["Anschlag", 448500]] },
  { title: "Flächen je Geschoss", note: "m² NRF", values: [["KG", 96.4], ["EG", 142.8], ["OG", 138.2], ["DG", 74.5]] },
];

async function chartSvg({ note, values }) {
  const spec = vegaLite.compile({
    width: 420, height: 200,
    config: { ...vegaLiteConfig, locale: { number: { decimal: ",", thousands: ".", grouping: [3], currency: ["", " €"] } } },
    data: { values: values.map(([label, value]) => ({ label, value })) },
    mark: { type: "bar" },
    encoding: {
      x: { field: "label", type: "nominal", sort: null, title: null, axis: { labelAngle: 0 } },
      y: { field: "value", type: "quantitative", title: note, axis: { format: ",.0f" } },
    },
  }).spec;
  const view = new vega.View(vega.parse(spec, null, { ast: true }), { expr: expressionInterpreter, renderer: "none" });
  const svg = await view.toSVG();
  await view.finalize();
  return svg;
}

export default async function () {
  const browser = await puppeteer.launch(env.BROWSER);
  const blocks = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 600, deviceScaleFactor: 2 });
    for (const chart of charts) {
      const svg = await chartSvg(chart);
      await page.setContent(`<body style="margin:0;background:#fff">${svg}</body>`);
      const element = await page.$("svg");
      const { width, height } = await element.boundingBox();
      const png = await element.screenshot({ type: "png" });
      blocks.push(
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(chart.title)] }),
        new Paragraph({ children: [new ImageRun({ type: "png", data: png, transformation: { width: Math.round(width), height: Math.round(height) } })] }),
      );
    }
  } finally {
    await browser.close();
  }

  const doc = new Document({
    styles: docxStyles,
    sections: [{ properties: { page: docxPage }, children: [new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun("Projektkennzahlen")] }), ...blocks] }],
  });
  await writeFile("/workspace/Projektkennzahlen.docx", await Packer.toBuffer(doc));
  return { file: "/workspace/Projektkennzahlen.docx", charts: charts.length };
}
