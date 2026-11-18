import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const XML_ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
const escape = (text) => text.replace(/[&<>]/g, (character) => XML_ENTITIES[character]);

export async function writeFontConfig(root, fontDirs) {
  const cache = join(root, "fontconfig-cache");
  await mkdir(cache, { recursive: true });
  const path = join(root, "fonts.conf");
  const dirs = fontDirs.map((dir) => `  <dir>${escape(dir)}</dir>`).join("\n");
  await writeFile(
    path,
    `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
${dirs}
  <cachedir>${escape(cache)}</cachedir>
  <alias><family>sans-serif</family><prefer><family>Source Sans 3</family></prefer></alias>
  <alias><family>system-ui</family><prefer><family>Source Sans 3</family></prefer></alias>
  <alias><family>monospace</family><prefer><family>Source Code Pro</family></prefer></alias>
</fontconfig>
`,
  );
  return path;
}
