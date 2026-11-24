---
status: proposed
date: 2026-11-22
decision-makers: engineering
consulted: support ticket 12 of 2026-11-20 (KAN-95); the geometry timing run of 2026-11-22 (`apps/workspace/scripts/measure-ifc-geometry-build.mjs`)
informed: everyone working on the model view and the answer cards
---

# A model is loaded once per page and its load can be stopped; geometry stays in the browser

## Context and Problem Statement

A customer on prod reported that the model view beside an answer runs for
several minutes and cannot be interrupted (KAN-95).

Every view of a model is its own load today. `use-ifc-model-load.ts` asks for a
fresh presigned URL, so the browser's HTTP cache never hits; downloads the
whole file; and starts its own geometry kernel and renderer. The element list
is walked again beside it. Nothing is shared between two cards, between a card
and the model view, or between two visits to a conversation. The only control
is „Abbrechen“ during the download. From the first parsed byte to the first
finished frame there is none, and a card cannot be collapsed.

We do not know where the customer's minutes went. The obvious suspect, the
geometry build, is not it for ordinary models. `@ifc-lite/geometry` 7.7.0 on
`processStreaming`, the path `processAdaptive` takes for a file of 2 MB or more
when `SharedArrayBuffer` is absent, which the workspace does not enable:

| Model (`CORPUS.md` number) | IFC | Build | First batch | Longest block | Meshes, raw | Meshes, gzip | RSS |
|---|---|---|---|---|---|---|---|
| 01 sample house | 2.3 MB | 0.2 s | 0.1 s | 0.1 s | 1.6 MB | 0.5 MB | 138 MB |
| 04 duplex | 2.4 MB | 0.3 s | 0.1 s | 0.1 s | 2.0 MB | 0.4 MB | 142 MB |
| 03 KIT institute | 10.9 MB | 0.8 s | 0.2 s | 0.2 s | 2.8 MB | 0.2 MB | 200 MB |
| 07 ArchiCAD 18 NL | 49.3 MB | 0.7 s | 0.3 s | 0.2 s | 13.3 MB | 2.4 MB | 283 MB |

Node v22.23.5, 2 CPUs, 8 GB, no network, 2026-11-22. How to run it again is
under More Information.

So ADR-0045's premise for keeping geometry in the browser (a streaming parser
at about 50 MB/s) still holds, and its revisit trigger ("models routinely
exceed what a laptop can parse in a few seconds") has not fired on this
evidence. The run does not cover the download, the GPU upload and the
finishing pass in a real browser, a model whose geometry the kernel struggles
with, or a load that never finishes. `ifc_model_opened` records only loads
that completed, so the slow and the abandoned ones are invisible today.

## Decision Drivers

* One way to load a model. A card, the file preview and the model view are
  views on the same building and must not differ in how they get it.
* A person can stop anything the page started, and put it away.
* Where geometry is built is decided on a measurement, not on a report of
  minutes.

## Considered Options

* **A. A page-level model store: one load per model and page, stoppable, with each phase timed.**
* **B. Build viewer geometry once at upload and serve prepared parts.**
* **C. Serve the workspace cross-origin isolated so the kernel's worker pool runs.**
* **D. Only add a cancel button to the build phase.**

## Decision Outcome

Chosen option: **A**, because it removes what is confirmed in code (every view
repeats the whole load, and nothing can be stopped after the download) without
betting on a cause the measurement does not support, and its phase timing is
what B and C must be decided on.

1. **One load per model and page.** A store, keyed by the model and its file
   version, owns the download, the element list and the built meshes. Every
   view asks the store. A second view of the same model costs a renderer, not
   a load. A view that leaves the screen gives its renderer back; the store
   keeps the meshes.
2. **Every phase can be stopped.** One control from the first byte to the
   first finished frame, and a started card collapses back to its still form.
3. **Each phase reports its time, finished or not.** Download, element list,
   build, GPU upload and finish each report a duration, and a load that is
   stopped, fails or is left reports the phase it was in.

**Geometry stays in the browser.** ADR-0045 stands. B and C are rejected on the
table above, each with a number that reopens it.

### Consequences

* Good, because two views of one model stop competing for the kernel. The
  single-threaded path keeps a module-level guard and refuses a second build
  while one runs (`GeometryProcessor processStreaming cannot start while …`,
  `activeWasmStreamingOperation`), which a second card meets as a load error.
  Read in the library, not reproduced in a browser.
* Good, because the next report of "minutes" comes with the phase it happened
  in.
* Bad, because the store keeps a model's meshes in memory for the life of the
  page (13.3 MB for the 49.3 MB model). It needs an eviction rule for a second
  and third model.
* Bad, because this does not explain the customer's minutes. If they come from
  the GPU phases or from one difficult model, the wait remains, though now
  with a way out.
* Neutral, because the source bytes are still fetched once per page load.
  Keeping them across page loads is a separate decision.

### Confirmation

Nothing enforces this yet; review is the only gate. What should:

* A spec on the store that mounts two views of one model and asserts one
  download and one build.
* A seam rule that only the store imports `@ifc-lite/geometry`, so a new view
  cannot start a private load.
* The phase events as rows in `docs/observability/posthog-events.md`, with a
  saved PostHog insight for p90 per phase. That file still lists
  `ifc_model_opened` under "considered and not emitted" although the load hook
  emits it; the row moves when the phase events land.

## Pros and Cons of the Options

### B. Prepared geometry at upload

The `bim_extract` job would build meshes with the same kernel (it starts in
Node, which is how the table was measured), store them in parts beside the
other `_bim/` artefacts, and the browser would hand them to
`renderer.addMeshes`.

* Good, because the download shrinks: 2.4 MB of gzipped meshes against a
  49.3 MB file.
* Good, because the browser stops parsing IFC at all.
* Bad, because the build it removes takes 0.7 s for a 49.3 MB model on one
  thread. Premise: the table above, four models. A model that takes the kernel
  tens of seconds would change this.
* Bad, because it adds a derived artefact that must be rebuilt when the kernel
  changes, a backfill for every stored model, and an encoder of our own: the
  package ships decoders for its packed formats and no JavaScript encoder
  (7.7.0).

### C. Cross-origin isolation for the worker pool

* Good, because the build leaves the main thread.
* Bad, because the longest main-thread block measured without it is 0.2 s.
  Premise: the same table.
* Bad, because `Cross-Origin-Embedder-Policy` constrains every cross-origin
  resource the workspace loads, and the package's worker build has already
  broken a production build once (`docs/contributing/gotchas.md`,
  `geometry.worker.ts`).

### D. Only a cancel button

* Good, because it is one small change.
* Bad, because every view still repeats the whole load, and two views still
  collide on the kernel's guard.

## More Information

**Run the timing again.** From `apps/workspace`, with its dependencies
installed and Node 22:

```bash
node scripts/measure-ifc-geometry-build.mjs /path/to/model.ifc
```

It prints one JSON line with the Node version, the CPU count, the package
version and the columns of the table. The table was taken one model per
process in `node:22.23.5-bookworm-slim` with `--cpus 2 -m 8g --network none`.
The models are numbers 01, 03, 04 and 07 of
[`packages/ifc-spatial-py/CORPUS.md`](../../packages/ifc-spatial-py/CORPUS.md),
which names where each comes from and its byte count.

**Revisit B** when the phase events show the build phase at p90 above 5 s, or
the download phase at p90 above 20 s, on prod over two weeks with at least 50
loads. **Revisit C** when the longest main-thread block in the build phase
passes 1 s at p90.

**Open before this is accepted.**

* Whether prod really takes the single-threaded path:
  `self.crossOriginIsolated` in the console on the workspace. Expected `false`;
  the repo sets no `Cross-Origin-Embedder-Policy` for it.
* A browser trace of the GPU upload and the finishing pass for the 49.3 MB
  model.
* Whether the customer's minutes are the answer and not the picture:
  `ifc_measure` runs IfcOpenShell over the file, and `CORPUS.md` records a
  208 s geometry pass for one 22 MB model.

PR #1604 (KAN-68) changes the same load hook and adds the load-failure event;
it lands first.
