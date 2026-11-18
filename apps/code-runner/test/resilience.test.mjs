import assert from "node:assert/strict";
import { request } from "node:http";
import { after, before, describe, test } from "node:test";
import { startRunner } from "./harness.mjs";

const MiB = 1024 * 1024;
const LINUX = process.platform === "linux";

const ARRAY_BUFFER_BOMB = `export default () => {
  const kept = [];
  for (let i = 0; i < 40; i++) { const bytes = new Uint8Array(100 * 1024 * 1024); bytes.fill(1); kept.push(bytes); }
  return kept.length;
}`;
const HEAP_BOMB = `export default () => {
  const kept = [];
  for (let i = 0; i < 1e8; i++) kept.push({ i, text: "room " + i });
  return kept.length;
}`;
const WAIT = (ms, value) => `export default () => new Promise((resolve) => setTimeout(() => resolve(${JSON.stringify(value)}), ${ms}))`;

async function until(check, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`${what} within ${timeoutMs} ms`);
}

async function health(runner) {
  return (await fetch(`${runner.url}/health`)).status;
}

async function bothSlotsServe(runner) {
  const results = await Promise.all([runner.run({ source: WAIT(300, "a") }), runner.run({ source: WAIT(300, "b") })]);
  assert.deepEqual(results.map((result) => [result.http, result.body.status, result.body.value]), [[200, "ok", "a"], [200, "ok", "b"]]);
}

const measured = {};
after(() => console.log(`resilience: ${JSON.stringify(measured)}`));

describe("memory per run", { skip: !LINUX && "the memory watch reads /proc" }, () => {
  let runner;
  before(async () => {
    runner = await startRunner({ slots: 2, watchdogGraceMs: 3000 });
  });
  after(async () => {
    await runner?.stop();
  });

  for (const [name, source] of [["an ArrayBuffer bomb", ARRAY_BUFFER_BOMB], ["a JS heap bomb", HEAP_BOMB]]) {
    test(`${name} ends in a clean error, another run beside it is unaffected, and both slots serve afterwards`, async () => {
      const beside = runner.run({ source: WAIT(1500, "beside") });
      await new Promise((resolve) => setTimeout(resolve, 100));
      const started = Date.now();
      const { http, body } = await runner.run({ source, timeoutMs: 60_000 });
      measured[name] = Date.now() - started;
      assert.equal(http, 200);
      assert.equal(body.status, "error");
      assert.match(body.stderr, /more memory than allowed \(768 MiB\)/);
      const other = await beside;
      assert.equal(other.body.status, "ok", other.body.stderr);
      assert.equal(other.body.value, "beside");
      assert.equal(await health(runner), 200);
      await bothSlotsServe(runner);
    });
  }

  test("a run at the input and output limits fits under the cap, and its slot is recycled afterwards", async () => {
    const files = ["a", "b"].map((name) => ({ path: `/workspace/in/${name}`, base64: Buffer.alloc(24 * MiB, 3).toString("base64") }));
    const source = `import { mkdir, readFile, writeFile } from "node:fs/promises";
      export default async () => {
        await mkdir("/workspace/out", { recursive: true });
        for (const name of ["a", "b"]) { const bytes = await readFile("/workspace/in/" + name); bytes[0] = 7; await writeFile("/workspace/out/" + name, bytes); }
        return "copied";
      }`;
    const { body } = await runner.run({ source, files });
    assert.equal(body.status, "ok", body.stderr);
    assert.deepEqual(body.files.map((file) => file.size), [24 * MiB, 24 * MiB]);
    await until(() => runner.slots.every((slot) => slot.ready && slot.memoryBytes() < slot.baselineBytes + 128 * MiB), 10_000, "every slot back under the recycle line");
  });
});

describe("slots that die", () => {
  let runner;
  before(async () => {
    runner = await startRunner({ slots: 2 });
  });
  after(async () => {
    await runner?.stop();
  });

  test("a slot killed during a run answers error, is restarted, and serves the next run", async () => {
    const running = runner.run({ source: WAIT(5000, "never") });
    await until(() => runner.slots.some((slot) => slot.busy), 2000, "a slot taking the run");
    process.kill(runner.slots.find((slot) => slot.busy).pid, "SIGKILL");
    const { body } = await running;
    assert.equal(body.status, "error");
    assert.match(body.stderr, /runtime stopped/);
    await bothSlotsServe(runner);
  });

  test("a slot that dies while idle is restarted, and /health holds while half the slots are ready", async () => {
    const [first] = runner.slots;
    const old = first.pid;
    process.kill(old, "SIGKILL");
    await until(() => !first.ready, 2000, "the killed slot noticed");
    assert.equal(await health(runner), 200, "one of two slots is half");
    await until(() => first.ready && first.pid !== old, 10_000, "the idle slot restarted");
    await bothSlotsServe(runner);
  });

  test("/health answers 503 when fewer than half the slots are ready, and 200 once they are back", async () => {
    const started = Date.now();
    for (const slot of runner.slots) process.kill(slot.pid, "SIGKILL");
    await until(() => runner.slots.every((slot) => !slot.ready), 2000, "both slots down");
    assert.equal(await health(runner), 503);
    await until(async () => (await health(runner)) === 200, 10_000, "health back");
    await until(() => runner.slots.every((slot) => slot.ready), 10_000, "both slots back");
    measured.bothSlotsBackMs = Date.now() - started;
    await bothSlotsServe(runner);
  });
});

function slowBody(url, length = 1000) {
  return new Promise((resolve) => {
    const req = request(`${url}/run`, { method: "POST", headers: { "content-type": "application/json", "content-length": String(length) } }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
      res.on("error", () => resolve({ status: res.statusCode, body: "" }));
    });
    req.on("error", (error) => resolve({ status: "reset", body: String(error) }));
    req.write('{"source": "export default');
  });
}

describe("request bodies", () => {
  let runner;
  before(async () => {
    runner = await startRunner({ slots: 1, bodyTimeoutMs: 1000 });
  });
  after(async () => {
    await runner?.stop();
  });

  test("slow bodies hold no slot, and end with 408 at the body timeout", async () => {
    const started = Date.now();
    const slow = Array.from({ length: 3 }, () => slowBody(runner.url));
    await new Promise((resolve) => setTimeout(resolve, 200));
    const { http, body } = await runner.run({ source: `export default () => "served"` });
    assert.equal(http, 200);
    assert.equal(body.value, "served");
    for (const result of await Promise.all(slow)) {
      assert.equal(result.status, 408, result.body);
      assert.match(result.body, /did not arrive within 1000 ms/);
    }
    assert.ok(Date.now() - started < 3000);
  });

  test("a run longer than the body timeout still answers", async () => {
    const { body } = await runner.run({ source: WAIT(2500, "late") });
    assert.equal(body.status, "ok", body.stderr);
    assert.equal(body.value, "late");
  });

  test("a body declared over the size limit is refused before it is read", async () => {
    const result = await slowBody(runner.url, 73 * MiB);
    assert.equal(result.status, 400, result.body);
    assert.match(result.body, /exceeds/);
  });
});
