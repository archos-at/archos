import puppeteer from "@cloudflare/puppeteer";
import { writeFile } from "node:fs/promises";
import { format, htmlPage, pdfOptions } from "house-style";

const rooms = [
  { room: "Wohnen/Essen", storey: "EG", area: 38.4 },
  { room: "Küche", storey: "EG", area: 11.2 },
  { room: "Zimmer 1", storey: "OG", area: 14.6 },
  { room: "Bad", storey: "OG", area: 7.9 },
];

const escape = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export default async function () {
  const total = rooms.reduce((sum, r) => sum + r.area * 100, 0) / 100;
  const html = htmlPage({
    title: "Flächenaufstellung",
    body: `
    <h1>Flächenaufstellung</h1>
    <div class="meta">Wohnhaus Musterweg 4 · Stand ${format.date(new Date())}</div>
    <div class="figures">
      <div><b>${format.area(total)}</b><span>Nutzfläche gesamt</span></div>
      <div><b>${rooms.length}</b><span>Räume</span></div>
    </div>
    <table>
      <thead><tr><th>Raum</th><th>Geschoss</th><th class="n">Fläche m²</th></tr></thead>
      <tbody>${rooms.map((r) => `<tr><td>${escape(r.room)}</td><td>${r.storey}</td><td class="n">${format.number(r.area)}</td></tr>`).join("")}</tbody>
      <tfoot><tr><td>Summe</td><td></td><td class="n">${format.number(total)}</td></tr></tfoot>
    </table>
    <div class="finding"><strong>Prüfen</strong> Die Fläche des Bads liegt unter dem Raumprogramm (8,50 m²).</div>`,
  });

  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf(pdfOptions("Wohnhaus Musterweg 4 · Flächenaufstellung"));
    await writeFile("/workspace/Flächenaufstellung.pdf", pdf);
    return { file: "/workspace/Flächenaufstellung.pdf", total, bytes: pdf.length };
  } finally {
    await browser.close();
  }
}
