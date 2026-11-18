# Code runner: `apps/code-runner`

A stateless HTTP service that runs one agent-written JavaScript (or TypeScript) ES module in a fresh
V8 isolate with no network, and returns the module's result and the files it wrote. It is the runtime
behind the agent's `execute` tool ([`docs/design/agent-code-execution.md`](../../docs/design/agent-code-execution.md)).

It runs self-hosted [workerd](https://github.com/cloudflare/workerd) with Cloudflare's
`@cloudflare/computer` package (MIT) and its `CodemodeBackend`: the backend builds a module graph from
the source, loads it into a Dynamic Worker (an isolate made by workerd's worker loader), and serves
`node:fs` inside it from a Durable Object's SQLite storage under `/workspace/`.

## Contract

`GET /health` answers `200 ok` once at least one workerd process is ready.

`POST /run` takes

```json
{ "source": "export default async (input) => ...", "language": "ts", "input": {},
  "files": [{ "path": "/workspace/in/rooms.csv", "base64": "..." }], "timeoutMs": 60000 }
```

and answers `200` with

```json
{ "status": "ok", "value": {}, "stdout": "", "stderr": "",
  "files": [{ "path": "/workspace/out/rooms.xlsx", "base64": "...", "size": 6342 }], "durationMs": 212 }
```

- `status` is `ok` when the default export returned, `error` when it threw, the module did not
  parse, imported something outside the manifest, or wrote more than the output limit, and `timeout`
  when it ran past `timeoutMs`.
- `value` is what the default export returned (JSON), `null` otherwise. The default export receives
  `input`.
- `console.log`/`info` go to `stdout`, `console.warn`/`error` and a thrown error's message to `stderr`.
- `files` holds only files under `/workspace/` that the run created or changed: each file sent in is
  hashed (SHA-256) before the run and compared after it.
- `language` defaults to `js`. `ts` strips types with `sucrase` (`transforms: ["typescript"]`) inside
  the worker before the run; plain JavaScript sent as `ts` passes through unchanged, which is what the
  agent sends. The measured cost is about 2 ms per run.
- `400 {error}`: no `source`, a source over 1 MiB, a `language` other than `js`/`ts`, a file path not
  under `/workspace/` or with an empty, `.` or `..` segment, a path sent twice, base64 that is not
  standard, `timeoutMs` not a positive number or over 180000, more than 50 MB of source, `input`
  and decoded files together, or a body that is not JSON.
- `503 {error: "busy"}`: every slot is running a run. The caller retries.

## Limits

| Limit | Value | Where |
|---|---|---|
| Run time | 60 s default, 180 s maximum | `src/limits.js`, passed to `CodemodeBackend` as `defaultTimeoutMs`, `maxTimeoutMs`, `maxCpuMs` |
| Runs in flight per process | 4 (`CODE_RUNNER_SLOTS`) | `bin/server.mjs` |
| Source | 1 MiB | `src/request.js` |
| Inputs (source, `input`, files) | 50 MB | `src/request.js`; the front refuses a body over 72 MiB before parsing |
| Returned files | 50 MB in total, else `status: error` and no files | `src/runner.js` |
| `stdout`, `stderr` | 64 KB each in the response | `src/runner.js` |
| Returned `value` | 8 MiB of JSON | `maxResultBytes` |
| Entries under `/workspace/` after a run | 10000 | `src/limits.js` |
| Network | none: `globalOutbound: null` for the run, and the front worker's outbound is a network service that allows nothing | `src/runner.js`, `config.capnp` |
| Memory per run | not enforced by self-hosted workerd | see below |

## How a run is held

```
caller ── HTTP :8080 ──> bin/server.mjs ──unix socket──> workerd slot n (one run at a time)
                          (slots, 503, watchdog,          src/worker.js ──> Runner Durable Object,
                           storage sweep)                  a new id per run ──> Dynamic Worker isolate
```

- **One workerd process per slot, one run per slot.** Self-hosted workerd does not enforce a CPU
  limit on a loader isolate: the backend's `cpuMs` is accepted and ignored, and the isolate runs on
  the same thread as the Durable Object and every other request of that process. A synchronous
  `for (;;) {}` therefore never yields to the backend's own timer and stops the whole process
  (measured: `/health` of that process stopped answering). `bin/server.mjs` holds each run with a
  watchdog at `timeoutMs` + 10 s; past it the slot's workerd is killed (`SIGKILL`), the run answers
  `status: timeout`, the slot's storage directory is deleted and a new workerd starts. A run that only
  waits (a promise that never settles) ends at `timeoutMs` through the backend's own timer. Since a
  slot holds one run, a looping run never delays another office's run.
- **A fresh Durable Object per run** (`env.RUNNER.newUniqueId()`): the input files are written into
  its storage, the module runs, the changed files are read back, and `ctx.storage.deleteAll()` runs in
  a `finally` before the response leaves. The `CodemodeBackend` is built per run, holding only the
  manifest libraries the source (or a script file sent in) names in quotes: handing every library to
  every isolate made a Word run take 1.5 s instead of 0.1 to 0.3 s, because the backend parses the
  whole module graph.
- **Storage on a memory-backed volume.** The Durable Object storage directory is
  `CODE_RUNNER_STORAGE_DIR` (default `/run/code-runner/do`), one subdirectory per slot. Mount an
  `emptyDir` with `medium: Memory` there. `deleteAll()` empties a run's SQLite file, but workerd
  keeps the emptied file (4 KB) of every object it opened; `bin/sweep.mjs` removes run files older
  than 5 minutes every minute (run ids are never reused, and no run lives that long), which also
  clears what a killed slot left. The test suite checks that no byte of a run's input or output is
  left in any file of the directory after a run.

## Running and testing

```bash
task runner:install   # bun install --frozen-lockfile in apps/code-runner
task runner:test      # build, then node --test against a real workerd
task runner:e2e       # build, then the agent's execute and file_draft tools against this server
task runner:serve     # build, then node bin/server.mjs on :8080
```

`task runner:e2e` is the whole path from the agent's side
(`packages/agent/tests/tools/execute/test_execute_with_the_runner.py`, marker `code_runner`): it
starts `node bin/server.mjs` on a free port (`PORT=0`, the port read from its first log line), runs
three office-skill examples (Word memo, Excel area schedule with `SUM`, vega chart) through
`agent.tools.execute.run.execute` into an in-memory draft store, checks the bytes with `zipfile` and
openpyxl, rewrites the workbook in a second run (draft version 1 to 2), files all three through
`file_draft` with only `bff_http.post_json` stubbed, and checks a thrown error and an endless loop.
It needs the root venv as well as this toolchain, so CI runs it in its own `runner-e2e` job. About
20 s, 11 of them the endless loop: with `timeout_seconds=1` the watchdog fires at 1 s plus its 10 s
grace. `pyproject.toml`'s `addopts` deselects the marker everywhere else; the test skips itself
when node or the build is missing, which the task's build step rules out.

The build (`build/build.mjs`) bundles each manifest library with esbuild into one ES module
(browser/worker conditions, Node built-ins left to the isolate's `nodejs_compat` `node:*` modules),
then bundles `src/worker.js` with those modules inlined as text into `dist/worker.js`, which
`config.capnp` embeds. workerd needs `--experimental` for the worker loader; `bin/slot.mjs` passes it.

`Dockerfile` builds on `node:22.23.4-bookworm-slim`, takes the workerd binary from the pinned
`workerd` npm package, runs as the non-root user `runner`, and starts `node bin/server.mjs` on 8080.

| Environment variable | Default | Meaning |
|---|---|---|
| `PORT`, `HOST` | `8080`, `0.0.0.0` | where the front listens |
| `CODE_RUNNER_SLOTS` | `4` | workerd processes, so runs in flight |
| `CODE_RUNNER_STORAGE_DIR` | `/run/code-runner/do` | Durable Object storage; mount memory here |

## Measured

`task runner:test` on a shared 4-core development container, 2026-11-18. Wall time of the HTTP call;
"first use" is the first run importing that library in its slot, so it includes compiling the library.

| What | Time |
|---|---|
| Word file, first run in a fresh slot (cold) | 328 ms (570 to 800 ms with the machine under load) |
| Word file, again in the same slot (warm) | 234 ms; 117 ms on an idle machine |
| Plain module, warm: JavaScript / the same module as TypeScript | 13 ms / 16 ms (median of 5) |
| Excel with a `SUM` formula | 376 ms (first use) |
| PDF made with pdf-lib, then its text read by unpdf | 1004 ms (first use; unpdf is 2.6 MiB) |
| Bar chart to SVG (vega-lite, vega, vega-interpreter) | 360 to 430 ms (first use) |
| papaparse, date-fns, decimal.js, marked | 30 to 63 ms |
| Infinite loop with `timeoutMs: 2000`, test grace 3 s | `timeout` after 5.0 s, the other slots serving meanwhile |
| workerd resident memory per slot | 134 MB idle, about 190 MB after a run |

Four slots hold about 540 MB before any run. The worst case, 4 × (190 MB per process + 128 MB in
the isolate + 50 MB of files) ≈ 1.5 GB, fits the pod's 2 GiB limit; for more runs add replicas, not
slots.

## The libraries

[`libraries.json`](libraries.json) is the manifest: the only modules a run can import besides
`node:fs/promises` and the Node built-ins `CodemodeBackend` allows. Each is imported by its npm name,
with both a default and named exports (`import docx from "docx"`, `import { Document } from "docx"`).

| Library | Version | Licence | For |
|---|---|---|---|
| docx | 9.15.3 | MIT | Word |
| exceljs | 4.4.0 | MIT | Excel, formulas |
| pdf-lib | 1.17.1 | MIT | create and modify PDF |
| unpdf | 2.1.0 | MIT | PDF text extraction |
| mathjs | 15.2.0 | Apache-2.0 | units, matrices |
| papaparse | 5.7.1 | MIT | CSV |
| date-fns | 4.4.0 | MIT | dates |
| jszip | 3.10.2 | MIT (dual MIT or GPL-3.0, taken under MIT) | ZIP |
| vega, vega-lite, vega-interpreter | 6.4.0, 6.5.0, 2.3.2 | BSD-3-Clause | charts to SVG |
| pptxgenjs | 4.0.1 | MIT | PowerPoint |
| marked | 18.1.3 | MIT | Markdown to HTML |
| decimal.js | 10.6.0 | MIT | exact decimals |

An isolate forbids `eval` and `new Function`, so a Vega view takes the interpreter:
`new vega.View(vega.parse(spec, null, { ast: true }), { expr: expressionInterpreter, renderer: "none" })`.

### Adding a library

A library is admitted only when it passes all five checks of the design doc, each in the PR that adds it:

1. **Licence**: MIT, ISC, Apache-2.0, BSD or 0BSD (a dual MIT-or-GPL package taken under MIT, with
   `license_note`). The build compares the manifest's licence with the installed package's.
2. **Maintained**: a release in the last two years, or a reason in the PR why an older one is fine.
3. **Pure JavaScript or WebAssembly**, no native add-on, and no code generated from strings.
4. **Works in the isolate**: a case in `test/libraries.test.mjs` that imports it by name inside a run
   and makes or reads its file type. The suite fails when the manifest and the cases differ.
5. **Size**: the bundled module stays under 4 MiB (`SIZE_BUDGET_BYTES` in `build/build.mjs`; the build
   prints each size), and the repository's vulnerability scan passes.

Then: pin the exact version in `package.json` (`bun add -d <name>@<version> --exact`), add its entry
to `libraries.json` with the same version, commit `bun.lock`, and run `task runner:test`. Its name
must not contain `/` (the backend refuses a scoped specifier).
