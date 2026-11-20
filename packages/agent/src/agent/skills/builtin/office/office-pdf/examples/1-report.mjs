import { writeFile } from "node:fs/promises";
import { compile } from "typst";
import { format, typstInputs, typstPreamble } from "house-style";

const rooms = [["EG", "Wohnen", 32.4], ["EG", "Küche", 11.2], ["OG", "Zimmer 1", 14.8]];

export default async function () {
  const rows = rooms.map(([floor, room, area]) => `[${floor}], [${room}], [${format.number(area)}],`).join("\n");
  const total = format.number(rooms.reduce((sum, [, , area]) => sum + area, 0));
  const markup = typstPreamble + String.raw`
#import "@preview/fletcher:0.5.8": diagram, node, edge
#import "@preview/timeliney:0.4.0"
#set heading(numbering: "1.")

#house-title([Baubeschreibung], subtitle: [Wohnhaus Lindengasse], meta: [Stand 18.11.2026])

= Flächen
#table(columns: (auto, 1fr, auto), align: (left, left, right),
  table.header[Geschoss][Raum][Fläche m²],
  ${rows}
  table.hline(stroke: 0.75pt + house.ink), [], [*Summe*], [*${total}*])

= Ablauf
#diagram(node-stroke: 0.6pt + house.ink, spacing: 14mm,
  node((0,0), [Entwurf]), edge("-|>"),
  node((1,0), [Einreichung]), edge("-|>"),
  node((2,0), [Bewilligung], fill: house.band))

= Terminplan
#timeliney.timeline(show-grid: true, {
  import timeliney: *
  headerline(group(([2027], 6)))
  headerline(group(..range(6).map(n => "M" + str(n + 1))))
  taskgroup(title: [Planung], {
    task("Vorentwurf", (0, 2), style: (stroke: 6pt + house.ink))
    task("Einreichplanung", (1.5, 4), style: (stroke: 6pt + house.muted))
  })
  milestone(at: 4, style: (stroke: (paint: house.markup, dash: "dashed")), align(center, text(fill: house.markup)[Einreichung]))
})
`;
  const pdf = await compile(markup, { inputs: typstInputs({ header: "Wohnhaus Lindengasse · Baubeschreibung", footer: "Stand 18.11.2026" }) });
  await writeFile("/workspace/Baubeschreibung.pdf", pdf);
  return { file: "/workspace/Baubeschreibung.pdf", bytes: pdf.byteLength };
}
