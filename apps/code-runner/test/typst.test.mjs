import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { extractText, getDocumentProxy } from "unpdf";
import manifest from "../libraries.json" with { type: "json" };
import { returned, startRunner } from "./harness.mjs";

let runner;
before(async () => {
  runner = await startRunner({ slots: 1 });
});
after(async () => {
  await runner?.stop();
});

const timings = {};

async function typst(markup) {
  const started = Date.now();
  const { http, body } = await runner.run({
    source: `import { compile } from "typst";
      import { writeFile } from "node:fs/promises";
      export default async (markup) => {
        const pdf = await compile(markup);
        await writeFile("/workspace/out.pdf", pdf);
        return pdf.byteLength;
      }`,
    input: markup,
    timeoutMs: 120_000,
  });
  assert.equal(http, 200);
  return { ...body, wallMs: Date.now() - started };
}

async function pdfText(result) {
  assert.equal(result.status, "ok", result.stderr);
  const pdf = await getDocumentProxy(new Uint8Array(returned(result, "/workspace/out.pdf")));
  const { text } = await extractText(pdf, { mergePages: true });
  const pages = pdf.numPages;
  await pdf.loadingTask?.destroy?.();
  return { pages, text };
}

const REPORT = String.raw`
#set page(paper: "a4", margin: (x: 20mm, top: 28mm, bottom: 24mm),
  header: [#set text(9pt); Musterbüro #h(1fr) Baubeschreibung],
  footer: context [#set text(9pt); #h(1fr) Seite #counter(page).display() von #counter(page).final().first()])
#set text(font: "Source Sans 3", lang: "de")
= Flächenaufstellung
#table(columns: (auto, 1fr, auto), align: (left, left, right),
  table.header[*Geschoss*][*Raum*][*Fläche m²*],
  [EG], [Wohnen], [32,40], [OG], [Zimmer 1], [14,80])
#pagebreak()
= Anhang
`;

test("a table, and a header and footer with page numbers", async () => {
  const result = await typst(REPORT);
  const { pages, text } = await pdfText(result);
  timings.report = `${result.wallMs} ms`;
  assert.equal(pages, 2);
  assert.match(text, /Zimmer 1/);
  assert.match(text, /Seite 1 von 2/);
  assert.match(text, /Seite 2 von 2/);
});

test("a flowchart with fletcher", async () => {
  const result = await typst(String.raw`
#import "@preview/fletcher:0.5.8": diagram, node, edge
#diagram(node-stroke: 0.6pt, node((0,0), [Entwurf]), edge("-|>"), node((1,0), [Einreichung]), edge("-|>"), node((2,0), [Bewilligung]))`);
  const { text } = await pdfText(result);
  timings.flowchart = `${result.wallMs} ms`;
  for (const label of ["Entwurf", "Einreichung", "Bewilligung"]) assert.match(text, new RegExp(label));
});

test("a Gantt chart for a project schedule with timeliney", async () => {
  const result = await typst(String.raw`
#import "@preview/timeliney:0.4.0"
#timeliney.timeline(show-grid: true, {
  import timeliney: *
  headerline(group(([*2027*], 4)))
  headerline(group(..range(4).map(n => strong("Q" + str(n + 1)))))
  taskgroup(title: [*Planung*], {
    task("Vorentwurf", (0, 1), style: (stroke: 2pt + gray))
    task("Einreichplanung", (1, 3), style: (stroke: 2pt + gray))
  })
  milestone(at: 3, style: (stroke: (dash: "dashed")), align(center, [*Einreichung*]))
})`);
  const { text } = await pdfText(result);
  timings.gantt = `${result.wallMs} ms`;
  for (const label of ["Vorentwurf", "Einreichplanung", "Q4"]) assert.match(text, new RegExp(label));
});

test("a sequence diagram with chronos", async () => {
  const result = await typst(String.raw`
#import "@preview/chronos:0.3.0"
#chronos.diagram({
  import chronos: *
  _par("A", display-name: "Architekt")
  _par("B", display-name: "Behörde")
  _seq("A", "B", comment: "Einreichung")
})`);
  const { text } = await pdfText(result);
  assert.match(text, /Behörde/);
});

test("a chart from Vega-Lite and an image the script hands in", async () => {
  const { http, body } = await runner.run({
    source: `import { compile } from "typst";
      import { writeFile } from "node:fs/promises";
      import * as vega from "vega";
      import * as vegaLite from "vega-lite";
      import { expressionInterpreter } from "vega-interpreter";
      export default async () => {
        const spec = vegaLite.compile({ data: { values: [{ k: "EG", v: 32 }, { k: "OG", v: 15 }] }, mark: "bar",
          encoding: { x: { field: "k", type: "nominal", title: "Geschoss" }, y: { field: "v", type: "quantitative" } } }).spec;
        const view = new vega.View(vega.parse(spec, null, { ast: true }), { expr: expressionInterpreter, renderer: "none" });
        const logo = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
        const pdf = await compile('#image("chart.svg", height: 6cm)\\n#image("brand/logo.svg", width: 20mm)', { files: { "chart.svg": await view.toSVG(), "brand/logo.svg": logo } });
        await writeFile("/workspace/out.pdf", pdf);
      }`,
    timeoutMs: 120_000,
  });
  assert.equal(http, 200);
  const { pages } = await pdfText(body);
  assert.equal(pages, 1);
});

test("a markup error comes back with its line, and nothing is written", async () => {
  const result = await typst("= Titel\n#table(columns: 2, [a]");
  assert.equal(result.status, "error");
  assert.match(result.stderr, /Typst could not compile the document/);
  assert.match(result.stderr, /main\.typ/);
  assert.deepEqual(result.files, []);
});

test("a package that is not bundled is not fetched: the run fails and names it", async () => {
  const result = await typst(`#import "@preview/cetz-plot:0.1.2"\nHallo`);
  assert.equal(result.status, "error");
  assert.match(result.stderr, /cetz-plot/);
});

test("every bundled package and font is pinned with a licence", () => {
  for (const entry of manifest.typst.packages) {
    assert.match(entry.sha256, /^[0-9a-f]{64}$/, entry.name);
    assert.ok(entry.license, entry.name);
  }
  for (const font of manifest.typst.fonts) assert.equal(font.license, "OFL-1.1");
});

after(() => {
  console.log(`typst timings: ${JSON.stringify(timings)}`);
});
