import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { startRunner } from "./harness.mjs";

const OFFICE =
  process.env.OFFICE_SKILLS_DIR ??
  join(dirname(fileURLToPath(import.meta.url)), "../../../packages/agent/src/agent/skills/builtin/office");

const MAGIC = { ".docx": "PK", ".xlsx": "PK", ".pptx": "PK", ".pdf": "%PDF-", ".svg": "<svg" };

let runner;
before(async () => {
  runner = await startRunner({ slots: 2 });
});
after(async () => {
  await runner?.stop();
});

async function scripts(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isFile()).map((entry) => join(dir, entry.name)).sort();
}

async function run(script, files) {
  const { http, body } = await runner.run({ source: await readFile(script, "utf8"), language: "ts", files, timeoutMs: 60000 });
  assert.equal(http, 200);
  assert.equal(body.status, "ok", `${basename(script)}: ${body.stderr}`);
  return body;
}

function keep(kept, body) {
  for (const file of body.files) {
    if (!file.path.startsWith("/workspace/in/")) kept.set(file.path, file.base64);
  }
}

for (const skill of (await readdir(OFFICE, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
  test(`every example of ${skill} runs in the isolate, in order, like one conversation`, async () => {
    const inputs = [];
    for (const fixture of await scripts(join(OFFICE, skill, "examples", "fixtures"))) {
      const body = await run(fixture, []);
      inputs.push(...body.files.map((file) => ({ path: file.path.replace("/workspace/", "/workspace/in/"), base64: file.base64 })));
    }
    const kept = new Map();
    for (const example of await scripts(join(OFFICE, skill, "examples"))) {
      const files = [...inputs, ...[...kept].map(([path, base64]) => ({ path, base64 }))];
      const body = await run(example, files);
      for (const file of body.files) {
        const magic = MAGIC[file.path.slice(file.path.lastIndexOf("."))];
        if (magic) assert.ok(Buffer.from(file.base64, "base64").toString("latin1").startsWith(magic), file.path);
      }
      keep(kept, body);
    }
  });
}
