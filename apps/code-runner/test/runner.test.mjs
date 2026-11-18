import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, test } from "node:test";
import JSZip from "jszip";
import { sweep } from "../bin/sweep.mjs";
import { b64, returned, startRunner } from "./harness.mjs";

const GRACE_MS = 3000;
let runner;
before(async () => {
  runner = await startRunner({ watchdogGraceMs: GRACE_MS });
});
after(async () => {
  await runner?.stop();
});

const timings = {};

describe("contract", () => {
  test("GET /health answers ok", async () => {
    const response = await fetch(`${runner.url}/health`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "ok");
  });

  test("a Word file is generated and returned (cold, then warm)", async () => {
    const source = `
      import docx from "docx";
      import { mkdir, writeFile } from "node:fs/promises";
      export default async function (input) {
        await mkdir("/workspace/out", { recursive: true });
        const doc = new docx.Document({ sections: [{ children: [
          new docx.Paragraph({ text: input.title, heading: docx.HeadingLevel.HEADING_1 }),
        ] }] });
        await writeFile("/workspace/out/note.docx", new Uint8Array(await docx.Packer.toArrayBuffer(doc)));
        return "written";
      }`;
    const body = { source, input: { title: "Aktenvermerk" } };
    let started = Date.now();
    const cold = await runner.run(body);
    timings.coldWordMs = Date.now() - started;
    started = Date.now();
    const warm = await runner.run(body);
    timings.warmWordMs = Date.now() - started;
    for (const { http, body: result } of [cold, warm]) {
      assert.equal(http, 200);
      assert.equal(result.status, "ok", result.stderr);
      assert.equal(result.value, "written");
      const docxBytes = returned(result, "/workspace/out/note.docx");
      assert.equal(result.files[0].size, docxBytes.length);
      const xml = await (await JSZip.loadAsync(docxBytes)).file("word/document.xml").async("string");
      assert.match(xml, /Aktenvermerk/);
      assert.equal(typeof result.durationMs, "number");
    }
  });

  test("a file sent in is readable, and input reaches the default export", async () => {
    const { body } = await runner.run({
      source: `import { readFile } from "node:fs/promises";
        export default async (input) => (await readFile("/workspace/in/rooms.csv", "utf8")) + input.suffix;`,
      input: { suffix: "!" },
      files: [{ path: "/workspace/in/rooms.csv", base64: b64("Raum;Fläche\nWohnen;32,4") }],
    });
    assert.equal(body.status, "ok", body.stderr);
    assert.equal(body.value, "Raum;Fläche\nWohnen;32,4!");
    assert.deepEqual(body.files, [], "an unread, unchanged input does not come back");
  });

  test("a changed file comes back, an unchanged one does not", async () => {
    const { body } = await runner.run({
      source: `import { readFile, writeFile } from "node:fs/promises";
        export default async () => {
          await writeFile("/workspace/a.txt", (await readFile("/workspace/a.txt", "utf8")) + " changed");
          await writeFile("/workspace/b.txt", await readFile("/workspace/b.txt"));
          return null;
        }`,
      files: [
        { path: "/workspace/a.txt", base64: b64("a") },
        { path: "/workspace/b.txt", base64: b64("b") },
      ],
    });
    assert.equal(body.status, "ok", body.stderr);
    assert.deepEqual(body.files.map((file) => file.path), ["/workspace/a.txt"]);
    assert.equal(returned(body, "/workspace/a.txt").toString(), "a changed");
  });

  test("console output goes to stdout and stderr", async () => {
    const { body } = await runner.run({ source: `export default () => { console.log("out"); console.error("err"); }` });
    assert.equal(body.status, "ok");
    assert.equal(body.value, null);
    assert.equal(body.stdout, "out\n");
    assert.equal(body.stderr, "err\n");
  });

  test("stdout is cut at 64 KB", async () => {
    const { body } = await runner.run({ source: `export default () => { for (let i = 0; i < 2000; i++) console.log("x".repeat(100)); }` });
    assert.equal(body.status, "ok");
    assert.ok(Buffer.byteLength(body.stdout) <= 64 * 1024, `${Buffer.byteLength(body.stdout)} bytes`);
  });

  test("TypeScript runs with its types stripped", async () => {
    const { body } = await runner.run({
      language: "ts",
      source: `interface Room { name: string; area: number }
        type Total = { area: number };
        export default function (input: { rooms: Room[] }): Total {
          const area: number = input.rooms.reduce((sum: number, room: Room) => sum + room.area, 0);
          return { area } as Total;
        }`,
      input: { rooms: [{ name: "Wohnen", area: 32 }, { name: "Küche", area: 11 }] },
    });
    assert.equal(body.status, "ok", body.stderr);
    assert.deepEqual(body.value, { area: 43 });
  });

  test("plain JavaScript sent as language ts runs unchanged", async () => {
    const { body } = await runner.run({
      language: "ts",
      source: `import { readFile } from "node:fs/promises";
        import Decimal from "decimal.js";
        const label = (room) => \`\${room.name}: \${room.area}\`;
        export default async function (input) {
          const extra = JSON.parse(await readFile("/workspace/extra.json", "utf8"));
          const rooms = [...input.rooms, ...extra];
          const total = rooms.reduce((sum, room) => sum.plus(room.area), new Decimal(0));
          return { labels: rooms.map(label), total: total.toString(), regex: /a<b>c/.test("a<b>c") };
        }`,
      input: { rooms: [{ name: "Wohnen", area: 32.4 }] },
      files: [{ path: "/workspace/extra.json", base64: b64(JSON.stringify([{ name: "Küche", area: 11.2 }])) }],
    });
    assert.equal(body.status, "ok", body.stderr);
    assert.deepEqual(body.value, { labels: ["Wohnen: 32.4", "Küche: 11.2"], total: "43.6", regex: true });
  });
});

describe("isolation", () => {
  test("fetch to the internet fails", async () => {
    const { body } = await runner.run({
      source: `export default async () => {
        try { await fetch("https://example.com"); return "reached"; } catch (error) { return "blocked: " + error.message; }
      }`,
    });
    assert.equal(body.status, "ok", body.stderr);
    assert.match(body.value, /^blocked/);
  });

  test("a thrown error is status error with the message on stderr", async () => {
    const { body } = await runner.run({ source: `export default () => { throw new Error("Fläche fehlt"); }` });
    assert.equal(body.status, "error");
    assert.match(body.stderr, /Fläche fehlt/);
    assert.equal(body.value, null);
  });

  test("a module that does not parse is status error", async () => {
    const { body } = await runner.run({ source: `export default () => {` });
    assert.equal(body.status, "error");
    assert.notEqual(body.stderr, "");
  });

  test("an import outside the manifest is status error", async () => {
    const { body } = await runner.run({ source: `import x from "left-pad"; export default () => x;` });
    assert.equal(body.status, "error");
    assert.match(body.stderr, /left-pad/);
  });

  test("an infinite loop ends as timeout within its limit, and the runner keeps serving", async () => {
    const started = Date.now();
    const looping = runner.run({ source: `export default () => { for (;;) {} }`, timeoutMs: 2000 });
    await new Promise((resolve) => setTimeout(resolve, 500));
    const during = await runner.run({ source: `export default () => "still here"` });
    assert.equal(during.body.value, "still here");
    const { body } = await looping;
    const elapsed = Date.now() - started;
    timings.timeoutOf2000Ms = elapsed;
    assert.equal(body.status, "timeout", body.stderr);
    assert.ok(elapsed < 2000 + GRACE_MS + 2000, `took ${elapsed} ms`);
    const afterwards = await runner.run({ source: `export default () => 1` });
    assert.equal(afterwards.body.value, 1);
  });

  test("an async wait past its limit ends as timeout from the runtime itself", async () => {
    const { body } = await runner.run({ source: `export default () => new Promise(() => {})`, timeoutMs: 1000 });
    assert.equal(body.status, "timeout", body.stderr);
  });

  test("a run sees nothing of the run before it", async () => {
    await runner.run({ source: `import { writeFile } from "node:fs/promises"; export default () => writeFile("/workspace/left.txt", "x");` });
    const { body } = await runner.run({ source: `import { readdir } from "node:fs/promises"; export default () => readdir("/workspace");` });
    assert.equal(body.status, "ok", body.stderr);
    assert.deepEqual(body.value, []);
  });

  test("no run data is left on disk, and the sweep removes the emptied files", async () => {
    await runner.run({
      source: `import { writeFile } from "node:fs/promises"; export default () => writeFile("/workspace/secret.txt", "Bauherr");`,
      files: [{ path: "/workspace/in.txt", base64: b64("Grundstück") }],
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const all = await readdir(runner.storage, { recursive: true, withFileTypes: true });
    for (const entry of all.filter((item) => item.isFile())) {
      const bytes = await readFile(join(entry.parentPath, entry.name));
      assert.ok(!bytes.includes("Bauherr") && !bytes.includes("Grundst"), `${entry.name} holds run data`);
    }
    const runFiles = all.filter((item) => item.isFile() && /^[0-9a-f]{64}\.sqlite$/.test(item.name));
    assert.ok(runFiles.length > 0, "the runs above opened storage");
    const scratch = await mkdtemp(join(tmpdir(), "code-runner-inspect-"));
    for (const entry of runFiles) {
      const copy = join(scratch, entry.name);
      await copyFile(join(entry.parentPath, entry.name), copy);
      const db = new DatabaseSync(copy, { readOnly: true });
      const tables = db.prepare("SELECT name FROM sqlite_master").all();
      db.close();
      assert.deepEqual(tables, [], `${entry.name} still holds ${JSON.stringify(tables)}`);
    }
    await rm(scratch, { recursive: true, force: true });
    const removed = await sweep(runner.storage, 0);
    assert.ok(removed >= runFiles.length);
    const left = (await readdir(runner.storage, { recursive: true })).filter((name) => /[0-9a-f]{64}/.test(name));
    assert.deepEqual(left, []);
  });
});

describe("bad requests and load", () => {
  const cases = {
    "missing source": {},
    "empty source": { source: "  " },
    "a path not under /workspace/": { source: "export default () => 1", files: [{ path: "/etc/passwd", base64: "" }] },
    "a .. segment": { source: "export default () => 1", files: [{ path: "/workspace/../etc/x", base64: "" }] },
    "a relative path": { source: "export default () => 1", files: [{ path: "workspace/x", base64: "" }] },
    "not base64": { source: "export default () => 1", files: [{ path: "/workspace/x", base64: "%%%" }] },
    "a source over 1 MiB": { source: `export default () => 1;//${"x".repeat(1024 * 1024)}` },
    "an unknown language": { source: "export default () => 1", language: "py" },
    "a timeout over 180 s": { source: "export default () => 1", timeoutMs: 180_001 },
    "inputs over 50 MB": { source: "export default () => 1", files: [{ path: "/workspace/big.bin", base64: Buffer.alloc(50 * 1024 * 1024 + 1).toString("base64") }] },
  };
  for (const [name, body] of Object.entries(cases)) {
    test(`400 for ${name}`, async () => {
      const { http, body: result } = await runner.run(body);
      assert.equal(http, 400);
      assert.equal(typeof result.error, "string");
    });
  }

  test("400 for a body that is not JSON", async () => {
    const { http } = await runner.run("{not json");
    assert.equal(http, 400);
  });

  test("a ninth concurrent run gets 503 busy", async () => {
    const slow = { source: `export default () => new Promise((resolve) => setTimeout(() => resolve("done"), 1500))` };
    const results = await Promise.all(Array.from({ length: 10 }, () => runner.run(slow)));
    const busy = results.filter((result) => result.http === 503);
    const ok = results.filter((result) => result.http === 200);
    assert.ok(busy.length >= 2, `expected 2 refused, got ${busy.length}`);
    assert.ok(ok.length <= 8);
    for (const result of busy) assert.deepEqual(result.body, { error: "busy" });
    for (const result of ok) assert.equal(result.body.value, "done");
  });
});

after(() => {
  console.log(`timings: ${JSON.stringify(timings)}`);
});
