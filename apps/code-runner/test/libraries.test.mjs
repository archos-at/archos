import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import manifest from "../libraries.json" with { type: "json" };
import { returned, startRunner } from "./harness.mjs";

let runner;
before(async () => {
  runner = await startRunner({ slots: 2 });
});
after(async () => {
  await runner?.stop();
});

async function ok(body) {
  const started = Date.now();
  const { http, body: result } = await runner.run(body);
  assert.equal(http, 200);
  assert.equal(result.status, "ok", result.stderr);
  return { ...result, wallMs: Date.now() - started };
}

const timings = {};

const CASES = {
  async docx() {
    const result = await ok({
      source: `import { Document, Packer, Paragraph, Table, TableRow, TableCell } from "docx";
        import { writeFile } from "node:fs/promises";
        export default async (rows) => {
          const table = new Table({ rows: rows.map((r) => new TableRow({ children: r.map((c) => new TableCell({ children: [new Paragraph(String(c))] })) })) });
          const doc = new Document({ sections: [{ children: [new Paragraph("Flächenaufstellung"), table] }] });
          await writeFile("/workspace/flaechen.docx", new Uint8Array(await Packer.toArrayBuffer(doc)));
        }`,
      input: [["EG", "Wohnen", 32.4], ["OG", "Zimmer 1", 14.8]],
    });
    const xml = await (await JSZip.loadAsync(returned(result, "/workspace/flaechen.docx"))).file("word/document.xml").async("string");
    assert.match(xml, /Flächenaufstellung/);
    assert.match(xml, /Zimmer 1/);
    return result;
  },

  async exceljs() {
    const result = await ok({
      source: `import ExcelJS from "exceljs";
        import { writeFile } from "node:fs/promises";
        export default async (rows) => {
          const wb = new ExcelJS.Workbook();
          const ws = wb.addWorksheet("Flächen");
          ws.addRow(["Geschoss", "Raum", "Fläche m²"]);
          rows.forEach((r) => ws.addRow(r));
          ws.addRow(["", "Summe", { formula: "SUM(C2:C" + (rows.length + 1) + ")" }]);
          await writeFile("/workspace/flaechen.xlsx", new Uint8Array(await wb.xlsx.writeBuffer()));
        }`,
      input: [["EG", "Wohnen", 32.4], ["EG", "Küche", 11.2], ["OG", "Zimmer 1", 14.8]],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(returned(result, "/workspace/flaechen.xlsx"));
    const sheet = wb.getWorksheet("Flächen");
    assert.equal(sheet.getCell("C5").formula, "SUM(C2:C4)");
    assert.equal(sheet.getCell("B3").value, "Küche");
    return result;
  },

  async "pdf-lib"() {
    const result = await ok({
      source: `import { PDFDocument, StandardFonts } from "pdf-lib";
        import { readFile, writeFile } from "node:fs/promises";
        export default async () => {
          const made = await PDFDocument.create();
          const font = await made.embedFont(StandardFonts.Helvetica);
          made.addPage().drawText("Planliste Index B", { x: 50, y: 700, font, size: 18 });
          await writeFile("/workspace/made.pdf", await made.save());
          const loaded = await PDFDocument.load(await readFile("/workspace/made.pdf"));
          loaded.addPage();
          await writeFile("/workspace/made.pdf", await loaded.save());
          return loaded.getPageCount();
        }`,
    });
    assert.equal(result.value, 2);
    assert.equal(returned(result, "/workspace/made.pdf").subarray(0, 5).toString(), "%PDF-");
    return result;
  },

  async unpdf() {
    const result = await ok({
      source: `import { PDFDocument, StandardFonts } from "pdf-lib";
        import { extractText, getDocumentProxy } from "unpdf";
        export default async () => {
          const doc = await PDFDocument.create();
          const font = await doc.embedFont(StandardFonts.Helvetica);
          doc.addPage().drawText("Bebauungsplan Nummer 42", { x: 50, y: 700, font, size: 14 });
          const pdf = await getDocumentProxy(await doc.save());
          const { totalPages, text } = await extractText(pdf, { mergePages: true });
          return { totalPages, text };
        }`,
    });
    assert.equal(result.value.totalPages, 1);
    assert.match(result.value.text, /Bebauungsplan Nummer 42/);
    return result;
  },

  async mathjs() {
    const result = await ok({
      source: `import { evaluate, det, unit } from "mathjs";
        export default () => ({
          area: evaluate("12.5 m * 4 m").toNumber("m^2"),
          det: det([[2, 1], [1, 3]]),
          cm: unit("1.2 m").toNumber("cm"),
        });`,
    });
    assert.deepEqual(result.value, { area: 50, det: 5, cm: 120 });
    return result;
  },

  async papaparse() {
    const result = await ok({
      source: `import Papa from "papaparse";
        export default (csv) => {
          const { data } = Papa.parse(csv, { header: true, delimiter: ";", skipEmptyLines: true });
          return { rows: data, back: Papa.unparse(data, { delimiter: ";" }) };
        }`,
      input: "Raum;Fläche\nWohnen;32,4\nKüche;11,2\n",
    });
    assert.deepEqual(result.value.rows, [{ Raum: "Wohnen", Fläche: "32,4" }, { Raum: "Küche", Fläche: "11,2" }]);
    assert.match(result.value.back, /^Raum;Fläche\r?\nWohnen;32,4/);
    return result;
  },

  async "date-fns"() {
    const result = await ok({
      source: `import { addBusinessDays, format, parseISO } from "date-fns";
        export default () => format(addBusinessDays(parseISO("2026-11-13"), 1), "yyyy-MM-dd");`,
    });
    assert.equal(result.value, "2026-11-16");
    return result;
  },

  async jszip() {
    const result = await ok({
      source: `import JSZip from "jszip";
        import { writeFile } from "node:fs/promises";
        export default async () => {
          const zip = new JSZip();
          zip.file("liste.txt", "A-101 Index C");
          const bytes = await zip.generateAsync({ type: "uint8array" });
          await writeFile("/workspace/paket.zip", bytes);
          return (await JSZip.loadAsync(bytes)).file("liste.txt").async("string");
        }`,
    });
    assert.equal(result.value, "A-101 Index C");
    const zip = await JSZip.loadAsync(returned(result, "/workspace/paket.zip"));
    assert.equal(await zip.file("liste.txt").async("string"), "A-101 Index C");
    return result;
  },

  async vega() {
    const result = await ok({
      source: `import * as vega from "vega";
        import * as vegaLite from "vega-lite";
        import { expressionInterpreter } from "vega-interpreter";
        import { writeFile } from "node:fs/promises";
        export default async (rows) => {
          const spec = vegaLite.compile({ data: { values: rows }, mark: "bar",
            encoding: { x: { field: "room", type: "nominal" }, y: { field: "area", type: "quantitative" } } }).spec;
          const view = new vega.View(vega.parse(spec, null, { ast: true }), { expr: expressionInterpreter, renderer: "none" });
          const svg = await view.toSVG();
          await writeFile("/workspace/chart.svg", svg);
          return svg.length;
        }`,
      input: [{ room: "Wohnen", area: 32.4 }, { room: "Küche", area: 11.2 }],
    });
    const svg = returned(result, "/workspace/chart.svg").toString();
    assert.match(svg, /^<svg/);
    assert.match(svg, /Wohnen/);
    return result;
  },

  "vega-lite": () => CASES.vega(),
  "vega-interpreter": () => CASES.vega(),

  async pptxgenjs() {
    const result = await ok({
      source: `import PptxGenJS from "pptxgenjs";
        import { writeFile } from "node:fs/promises";
        export default async () => {
          const pptx = new PptxGenJS();
          pptx.addSlide().addText("Bauherrenbesprechung", { x: 1, y: 1, fontSize: 24 });
          await writeFile("/workspace/deck.pptx", await pptx.write({ outputType: "uint8array" }));
        }`,
    });
    const zip = await JSZip.loadAsync(returned(result, "/workspace/deck.pptx"));
    assert.match(await zip.file("ppt/slides/slide1.xml").async("string"), /Bauherrenbesprechung/);
    return result;
  },

  async marked() {
    const result = await ok({
      source: `import { marked } from "marked";
        export default () => marked.parse("# Protokoll\\n\\n- Punkt **eins**");`,
    });
    assert.match(result.value, /<h1>Protokoll<\/h1>/);
    assert.match(result.value, /<strong>eins<\/strong>/);
    return result;
  },

  async "decimal.js"() {
    const result = await ok({
      source: `import Decimal from "decimal.js";
        export default () => new Decimal("0.1").plus("0.2").toString();`,
    });
    assert.equal(result.value, "0.3");
    return result;
  },
};

test("every manifest library has an isolate case, and no case lacks a manifest entry", () => {
  assert.deepEqual(Object.keys(CASES).sort(), manifest.libraries.map((lib) => lib.name).sort());
});

for (const lib of manifest.libraries) {
  test(`${lib.name} ${lib.version} works inside the isolate`, async () => {
    const result = await CASES[lib.name]();
    timings[lib.name] = `${result.wallMs} ms (run ${result.durationMs} ms)`;
  });
}

test("TypeScript stripping adds only milliseconds", async () => {
  const body = { source: `export default (input) => input.map((x) => x * 2);`, input: [1, 2, 3] };
  const tsBody = { ...body, language: "ts", source: `type N = number;\nexport default (input: N[]): N[] => input.map((x: N) => x * 2);` };
  const js = [];
  const ts = [];
  for (let i = 0; i < 5; i++) {
    js.push((await ok(body)).durationMs);
    ts.push((await ok(tsBody)).durationMs);
  }
  const median = (values) => values.sort((a, b) => a - b)[2];
  timings.plainJsMedian = `${median(js)} ms`;
  timings.typescriptMedian = `${median(ts)} ms`;
  assert.ok(median(ts) - median(js) < 50, `ts ${median(ts)} ms vs js ${median(js)} ms`);
});

after(() => {
  console.log(`timings: ${JSON.stringify(timings)}`);
});
