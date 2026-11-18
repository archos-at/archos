import { readFile, writeFile } from "node:fs/promises";
import JSZip from "jszip";

const escapeXml = (text) =>
  String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function placeholder(key) {
  const letters = `{{${key}}}`.split("").map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(letters.join("(?:<[^>]+>)*"), "g");
}

export default async function () {
  const values = {
    PROJEKT: "Wohnhaus Musterstraße 12",
    DATUM: "18.11.2026",
    BETREFF: "Abstimmung Fassade & Fenster",
  };
  const zip = await JSZip.loadAsync(await readFile("/workspace/in/Briefpapier.docx"));
  const parts = Object.keys(zip.files).filter((name) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(name));
  const replaced = {};
  for (const name of parts) {
    let xml = await zip.file(name).async("string");
    for (const [key, value] of Object.entries(values)) {
      xml = xml.replace(placeholder(key), () => {
        replaced[key] = (replaced[key] ?? 0) + 1;
        return escapeXml(value);
      });
    }
    zip.file(name, xml);
  }
  const left = [];
  for (const name of parts) {
    const text = (await zip.file(name).async("string")).replace(/<[^>]+>/g, "");
    left.push(...(text.match(/\{\{[A-Z_]+\}\}/g) ?? []));
  }
  await writeFile("/workspace/Aktenvermerk.docx", await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
  return { replaced, left };
}
