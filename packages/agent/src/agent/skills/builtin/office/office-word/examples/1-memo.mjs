import { writeFile } from "node:fs/promises";
import Decimal from "decimal.js";
import {
  AlignmentType, Document, Footer, Header, HeadingLevel, LevelFormat, Packer, PageNumber,
  Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
} from "docx";

const area = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

const COLUMNS = [1400, 5154, 2800];

function cell(text, width, { header = false, right = false } = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: header ? { type: ShadingType.CLEAR, fill: "D9D9D9", color: "auto" } : undefined,
    children: [new Paragraph({
      alignment: right ? AlignmentType.RIGHT : AlignmentType.LEFT,
      children: [new TextRun({ text, bold: header })],
    })],
  });
}

export default async function () {
  const rooms = [
    { storey: "EG", name: "Wohnen", area: 32.4 },
    { storey: "EG", name: "Küche", area: 11.2 },
    { storey: "OG", name: "Zimmer 1", area: 14.85 },
  ];
  const total = rooms.reduce((sum, room) => sum.plus(room.area), new Decimal(0)).toNumber();

  const table = new Table({
    width: { size: COLUMNS.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: COLUMNS,
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          cell("Geschoss", COLUMNS[0], { header: true }),
          cell("Raum", COLUMNS[1], { header: true }),
          cell("Fläche m²", COLUMNS[2], { header: true, right: true }),
        ],
      }),
      ...rooms.map((room) => new TableRow({
        children: [
          cell(room.storey, COLUMNS[0]),
          cell(room.name, COLUMNS[1]),
          cell(area.format(room.area), COLUMNS[2], { right: true }),
        ],
      })),
      new TableRow({
        children: [
          cell("", COLUMNS[0]),
          cell("Summe", COLUMNS[1], { header: true }),
          cell(area.format(total), COLUMNS[2], { header: true, right: true }),
        ],
      }),
    ],
  });

  const doc = new Document({
    creator: "Office",
    title: "Aktenvermerk",
    styles: {
      default: {
        document: { run: { font: "Arial", size: 20 } },
        heading1: { run: { font: "Arial", size: 28, bold: true, color: "000000" }, paragraph: { spacing: { before: 240, after: 120 }, keepNext: true } },
        heading2: { run: { font: "Arial", size: 22, bold: true, color: "000000" }, paragraph: { spacing: { before: 200, after: 80 }, keepNext: true } },
      },
    },
    numbering: {
      config: [{
        reference: "bullets",
        levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 260 } } } }],
      }],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1418, bottom: 1134, left: 1418, right: 1134, header: 709, footer: 709 },
        },
      },
      headers: {
        default: new Header({ children: [new Paragraph({ children: [new TextRun("Projekt Musterstraße 12")] })] }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ children: ["Seite ", PageNumber.CURRENT, " von ", PageNumber.TOTAL_PAGES] })],
          })],
        }),
      },
      children: [
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Aktenvermerk")] }),
        new Paragraph({ children: [new TextRun(`Datum: ${date.format(new Date(2026, 10, 18))}`)] }),
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Flächen")] }),
        new Paragraph({
          spacing: { after: 120 },
          children: [
            new TextRun("Die Nutzfläche beträgt "),
            new TextRun({ text: `${area.format(total)} m`, bold: true }),
            new TextRun({ text: "2", bold: true, superScript: true }),
            new TextRun("."),
          ],
        }),
        table,
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Nächste Schritte")] }),
        ...["Fensterfarbe mit der Bauherrschaft festlegen", "Flächen nach dem nächsten Stand prüfen"].map(
          (text) => new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun(text)] }),
        ),
      ],
    }],
  });

  await writeFile("/workspace/Aktenvermerk.docx", await Packer.toBuffer(doc));
  return { file: "/workspace/Aktenvermerk.docx", rooms, total };
}
