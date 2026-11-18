import { readFile } from "node:fs/promises";
import JSZip from "jszip";

export default async function () {
  const zip = await JSZip.loadAsync(await readFile("/workspace/Aktenvermerk.docx"));
  const xml = await zip.file("word/document.xml").async("string");
  const paragraphs = xml
    .split("</w:p>")
    .map((p) => p.replace(/<w:tab\/>/g, "\t").replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&"))
    .filter((text) => text.trim());
  return {
    parts: Object.keys(zip.files).filter((name) => /^word\/(header|footer)\d*\.xml$/.test(name)),
    paragraphs: paragraphs.slice(0, 40),
    tables: (xml.match(/<w:tbl>/g) ?? []).length,
    placeholdersLeft: paragraphs.join("\n").match(/\{\{[A-Z_]+\}\}/g) ?? [],
  };
}
