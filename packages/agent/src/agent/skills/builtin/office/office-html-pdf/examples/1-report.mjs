import puppeteer from "@cloudflare/puppeteer";
import { writeFile } from "node:fs/promises";

const rooms = [
  { room: "Wohnen/Essen", storey: "EG", area: 38.4 },
  { room: "Küche", storey: "EG", area: 11.2 },
  { room: "Zimmer 1", storey: "OG", area: 14.6 },
  { room: "Bad", storey: "OG", area: 7.9 },
];

const area = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const escape = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export default async function () {
  const total = rooms.reduce((sum, r) => sum + r.area * 100, 0) / 100;
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 22mm 18mm 20mm; }
    body { font-family: "Source Sans 3", sans-serif; font-size: 10.5pt; color: #1f2933; }
    h1 { font-size: 22pt; font-weight: 600; margin: 0 0 2mm; }
    .meta { color: #616e7c; margin-bottom: 8mm; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-weight: 600; border-bottom: 1.2pt solid #1f2933; padding: 2mm 0; }
    td { border-bottom: 0.5pt solid #cbd2d9; padding: 1.8mm 0; }
    td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
    tr { break-inside: avoid; }
    tfoot td { font-weight: 600; border-bottom: none; border-top: 1.2pt solid #1f2933; }
  </style></head><body>
    <h1>Flächenaufstellung</h1>
    <div class="meta">Wohnhaus Musterweg 4 · Stand ${new Intl.DateTimeFormat("de-DE").format(new Date())}</div>
    <table>
      <thead><tr><th>Raum</th><th>Geschoss</th><th class="n">Fläche m²</th></tr></thead>
      <tbody>${rooms.map((r) => `<tr><td>${escape(r.room)}</td><td>${r.storey}</td><td class="n">${area.format(r.area)}</td></tr>`).join("")}</tbody>
      <tfoot><tr><td>Summe</td><td></td><td class="n">${area.format(total)}</td></tr></tfoot>
    </table>
  </body></html>`;

  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `<div style="font: 8pt 'Source Sans 3'; width: 100%; padding: 0 18mm; text-align: right; color: #616e7c">
        Seite <span class="pageNumber"></span> von <span class="totalPages"></span></div>`,
    });
    await writeFile("/workspace/Flächenaufstellung.pdf", pdf);
    return { file: "/workspace/Flächenaufstellung.pdf", total, bytes: pdf.length };
  } finally {
    await browser.close();
  }
}
