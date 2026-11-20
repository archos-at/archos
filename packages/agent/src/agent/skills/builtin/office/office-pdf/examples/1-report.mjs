import { writeFile } from "node:fs/promises";
import { compile } from "typst";

const rooms = [["EG", "Wohnen", 32.4], ["EG", "Küche", 11.2], ["OG", "Zimmer 1", 14.8]];
const de = (n) => n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function () {
  const rows = rooms.map(([floor, room, area]) => `[${floor}], [${room}], [${de(area)}],`).join("\n");
  const total = de(rooms.reduce((sum, [, , area]) => sum + area, 0));
  const markup = String.raw`
#import "@preview/fletcher:0.5.8": diagram, node, edge
#import "@preview/timeliney:0.4.0"
#set page(paper: "a4", margin: (x: 20mm, top: 28mm, bottom: 24mm),
  header: [#set text(9pt, fill: luma(90)); Büro #h(1fr) Wohnhaus Lindengasse],
  footer: context [#set text(9pt, fill: luma(90)); Stand 18.11.2026 #h(1fr)
    Seite #counter(page).display() von #counter(page).final().first()])
#set text(font: "Source Sans 3", size: 10.5pt, lang: "de")
#set heading(numbering: "1.")

= Flächen
#table(columns: (auto, 1fr, auto), align: (left, left, right), stroke: none,
  fill: (_, y) => if y == 0 { luma(230) },
  table.header[*Geschoss*][*Raum*][*Fläche m²*],
  ${rows}
  table.hline(), [], [*Summe*], [*${total}*])

= Ablauf
#diagram(node-stroke: 0.6pt, spacing: 14mm,
  node((0,0), [Entwurf], corner-radius: 3pt), edge("-|>"),
  node((1,0), [Einreichung], corner-radius: 3pt), edge("-|>"),
  node((2,0), [Bewilligung], corner-radius: 3pt))

= Terminplan
#timeliney.timeline(show-grid: true, {
  import timeliney: *
  headerline(group(([*2027*], 6)))
  headerline(group(..range(6).map(n => strong("M" + str(n + 1)))))
  taskgroup(title: [*Planung*], {
    task("Vorentwurf", (0, 2), style: (stroke: 6pt + rgb("#4C6A92")))
    task("Einreichplanung", (1.5, 4), style: (stroke: 6pt + rgb("#4C6A92")))
  })
  milestone(at: 4, style: (stroke: (dash: "dashed")), align(center, [*Einreichung*]))
})

`;
  const pdf = await compile(markup);
  await writeFile("/workspace/Baubeschreibung.pdf", pdf);
  return { file: "/workspace/Baubeschreibung.pdf", bytes: pdf.byteLength };
}
