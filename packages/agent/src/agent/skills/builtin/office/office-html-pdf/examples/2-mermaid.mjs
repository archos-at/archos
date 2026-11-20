import puppeteer from "@cloudflare/puppeteer";
import docx from "docx";
import { writeFile } from "node:fs/promises";

const diagram = `flowchart LR
  E[Entwurf] --> B[Baueingabe]
  B --> P{Prüfung}
  P -- Mängel --> E
  P -- ok --> G[Bewilligung]`;

export default async function () {
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 800, deviceScaleFactor: 2 });
    await page.setContent('<body style="margin:0"></body>');
    await page.addScriptTag({ url: "http://assets.local/mermaid.min.js" });
    const svg = await page.evaluate(async (source) => {
      mermaid.initialize({
        startOnLoad: false,
        theme: "neutral",
        htmlLabels: false,
        flowchart: { htmlLabels: false },
        themeVariables: { fontFamily: '"Source Sans 3", sans-serif' },
      });
      return (await mermaid.render("ablauf", source)).svg;
    }, diagram);
    await page.setContent(`<body style="margin:0; background:#fff">${svg}</body>`);
    const element = await page.$("svg");
    const box = await element.boundingBox();
    const png = await element.screenshot({ type: "png" });
    await writeFile("/workspace/Ablauf.svg", svg);
    await writeFile("/workspace/Ablauf.png", png);

    const width = 450;
    const height = Math.round((width * box.height) / box.width);
    const doc = new docx.Document({
      sections: [{
        children: [
          new docx.Paragraph({ text: "Ablauf der Einreichung", heading: docx.HeadingLevel.HEADING_1 }),
          new docx.Paragraph({ children: [new docx.ImageRun({ type: "png", data: png, transformation: { width, height } })] }),
        ],
      }],
    });
    await writeFile("/workspace/Ablauf.docx", new Uint8Array(await docx.Packer.toArrayBuffer(doc)));
    return { files: ["/workspace/Ablauf.svg", "/workspace/Ablauf.png", "/workspace/Ablauf.docx"], size: { width: box.width, height: box.height } };
  } finally {
    await browser.close();
  }
}
