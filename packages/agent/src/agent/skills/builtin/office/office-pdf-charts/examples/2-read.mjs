import { readFile } from "node:fs/promises";
import { extractText, getDocumentProxy } from "unpdf";

export default async function () {
  const pdf = await getDocumentProxy(new Uint8Array(await readFile("/workspace/Planliste.pdf")));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  return { totalPages, pages: text.map((page, i) => ({ page: i + 1, chars: page.length, start: page.slice(0, 400) })) };
}
