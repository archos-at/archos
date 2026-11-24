import { writeFile } from "node:fs/promises";
import Decimal from "decimal.js";
import {
  AlignmentType, Document, Footer, Header, HeadingLevel, LevelFormat, Packer, PageNumber,
  Paragraph, Table, TableCell, TableRow, TextRun, WidthType,
} from "docx";
import { colors, docxHeaderCell, docxPage, docxStyles, docxTableBorders, hex } from "house-style";

const area = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

const COLUMNS = [1400, 5154, 2800];

function cell(text, width, { header = false, right = false } = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    ...(header ? docxHeaderCell() : {}),
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
    borders: docxTableBorders(),
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
    styles: docxStyles,
    numbering: {
      config: [{
        reference: "bullets",
        levels: [{ level: 0, format: LevelFormat.BULLET, text: "–", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 260 } } } }],
      }],
    },
    sections: [{
      properties: { page: docxPage },
      headers: {
        default: new Header({ children: [new Paragraph({ children: [new TextRun({ text: "Projekt Musterstraße 12", size: 16, color: hex(colors.muted) })] })] }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ children: [PageNumber.CURRENT, " / ", PageNumber.TOTAL_PAGES], size: 16, color: hex(colors.muted) })],
          })],
        }),
      },
      children: [
        new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun("Aktenvermerk")] }),
        new Paragraph({ style: "Meta", children: [new TextRun(`Projekt Musterstraße 12 · ${date.format(new Date(2026, 10, 18))}`)] }),
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Flächen")] }),
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
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Nächste Schritte")] }),
        ...["Fensterfarbe mit der Bauherrschaft festlegen", "Flächen nach dem nächsten Stand prüfen"].map(
          (text) => new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun(text)] }),
        ),
      ],
    }],
  });

  await writeFile("/workspace/Aktenvermerk.docx", await Packer.toBuffer(doc));
  return { file: "/workspace/Aktenvermerk.docx", rooms, total };
}
