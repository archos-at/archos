import { writeFile } from "node:fs/promises";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const A4 = [595.28, 841.89];
const MARGIN = 56.7;

const WIN_ANSI = { "≤": "<=", "≥": ">=", "−": "-", "≈": "~", "Δ": "Delta ", "⌀": "Ø", "∅": "Ø", "\u202f": " " };
const safe = (text) => [...String(text)].map((ch) => WIN_ANSI[ch] ?? ch).join("");

function wrap(text, font, size, width) {
  const lines = [];
  let current = "";
  for (const word of safe(text).split(/\s+/)) {
    const next = current ? `${current} ${word}` : word;
    if (current && font.widthOfTextAtSize(next, size) > width) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  return current ? [...lines, current] : lines;
}

export default async function () {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Planliste");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage(A4);
  let y = A4[1] - MARGIN;

  const line = (text, { font = regular, size = 10, x = MARGIN, right = false } = {}) => {
    const shown = safe(text);
    const at = right ? x - font.widthOfTextAtSize(shown, size) : x;
    page.drawText(shown, { x: at, y, size, font, color: rgb(0, 0, 0) });
  };

  line("Planliste", { font: bold, size: 16 });
  y -= 28;
  const rows = [["A-101", "Grundriss EG", "C", "12.11.2026"], ["A-102", "Grundriss OG", "B", "03.11.2026"]];
  for (const [index, row] of [["Nummer", "Inhalt", "Index", "Datum"], ...rows].entries()) {
    if (y < MARGIN + 40) {
      page = pdf.addPage(A4);
      y = A4[1] - MARGIN;
    }
    const font = index === 0 ? bold : regular;
    line(row[0], { font });
    line(row[1], { font, x: MARGIN + 70 });
    line(row[2], { font, x: MARGIN + 300 });
    line(row[3], { font, x: A4[0] - MARGIN, right: true });
    y -= 16;
  }
  y -= 8;
  const note = "Brüstungshöhe ≥ 1,00 m bei allen Fenstern im OG; die Fläche der Wohnung beträgt 58,45 m². Abweichungen sind mit der Bauherrschaft abzustimmen und im nächsten Stand einzuarbeiten.";
  for (const text of wrap(note, regular, 9, A4[0] - 2 * MARGIN)) {
    line(text, { size: 9 });
    y -= 12;
  }

  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const label = `Seite ${i + 1} von ${pages.length}`;
    p.drawText(label, { x: A4[0] - MARGIN - regular.widthOfTextAtSize(label, 8), y: 28, size: 8, font: regular });
  });

  await writeFile("/workspace/Planliste.pdf", await pdf.save());
  return { file: "/workspace/Planliste.pdf", pages: pages.length };
}
