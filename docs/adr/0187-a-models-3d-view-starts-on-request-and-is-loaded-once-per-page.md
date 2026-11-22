---
status: proposed
date: 2026-11-22
decision-makers: engineering; the product owner for the card's behaviour in the chat
consulted: support ticket 12 of 2026-11-20 (KAN-95); the geometry timing run of 2026-11-22 on VD-FW
informed: everyone working on the model view, the answer cards and the BIM skill
---

# A model's 3D view starts on request and is loaded once per page; geometry stays in the browser

## Context and Problem Statement

A customer on prod reported that the model view beside an answer runs for
several minutes and cannot be interrupted, and asked to suppress it and to see
only some elements, "only the stairs" (KAN-95).

What the customer sees is the `ifc_viewer` answer card. The BIM skill makes it
the default for a measured answer, and the card mounts a live 3D viewer the
moment it is rendered (`ui/features/cards/components/IfcViewerCard.tsx`). Each
card is its own load: a fresh presigned URL, so the browser's HTTP cache never
hits; the whole file; a walk over every element; its own geometry kernel and
its own renderer (`ui/features/bim/hooks/use-ifc-model-load.ts`). Nothing is
shared between two cards, between a card and the model view, or between two
visits to a conversation. The only control is „Abbrechen“ during the download.
From the first parsed byte to the first finished frame there is none, and the
card cannot be collapsed.

We do not know where the customer's minutes went. The obvious suspect, the
geometry build, is not it for ordinary models. Measured on 2026-11-22 with
`@ifc-lite/geometry` 7.7.0 on its single-threaded path (the one a browser takes
without `SharedArrayBuffer`, which the workspace does not enable), in Node 22
on two cores:

| Model | IFC | Build | Longest block | Meshes, raw | Meshes, gzip |
|---|---|---|---|---|---|
| Sample house | 2.3 MB | 0.2 s | 0.1 s | 1.6 MB | 0.5 MB |
| Duplex | 2.4 MB | 0.3 s | 0.1 s | 2.0 MB | 0.4 MB |
| KIT institute | 10.9 MB | 0.8 s | 0.2 s | 2.8 MB | 0.2 MB |
| ArchiCAD 18 NL | 49.3 MB | 0.7 s | 0.2 s | 13.3 MB | 2.4 MB |

So ADR-0045's premise for keeping geometry in the browser (a streaming parser
at about 50 MB/s) still holds, and its revisit trigger ("models routinely
exceed what a laptop can parse in a few seconds") has not fired on this
evidence. What the run does not cover: the download, the GPU upload and the
finishing pass in a real browser, a model whose geometry the kernel struggles
with, and a load that never finishes. `ifc_model_opened` records only loads
that completed, so the slow and the abandoned ones are invisible today.

## Decision Drivers

* The person decides what is on their screen. ADR-0144 already holds the model
  view back until „Anzeigen“; a card that starts 3D unasked breaks that rule in
  the same chat.
* A person who asked about a building element sees it without typing a second
  question (KAN-5, KAN-39).
* One way to load a model. A card, the file preview and the model view are
  views on the same building and must not differ in how they get it.
* A decision about where geometry is built rests on a measurement, not on a
  report of minutes.
* "Only the stairs" is a view, in the same words the agent already uses to
  select elements.

## Considered Options

* **A. One model load per page, started on request, with the phases measured.**
* **B. Build viewer geometry once at upload and serve prepared parts.**
* **C. Serve the workspace cross-origin isolated so the kernel's worker pool runs.**
* **D. Keep the card as it is and tell the agent to attach it less often.**
* **E. Do nothing beyond a cancel button for the build phase.**

## Decision Outcome

Chosen option: **A**, because it removes what is confirmed in code (3D starts
unasked, every card repeats the whole load, nothing can be stopped or put
away) without betting on a cause that the measurement does not support, and it
gives us the numbers to decide B on.

**The rule.**

1. **3D starts on request.** An `ifc_viewer` card arrives as a still card: its
   title, its legend of highlight groups with counts, its note, and „3D-Ansicht
   laden“. Nothing is downloaded or parsed before that press. The press is the
   person's, as „Anzeigen“ is in ADR-0144.
2. **One load per model and page.** A page-level model store, keyed by the
   model and its file version, owns the download, the element list and the
   built meshes. Every view (card, file preview, model view) asks the store.
   A second card for the same model costs a renderer, not a load. A view that
   leaves the screen gives its renderer back; the store keeps the meshes.
3. **Every phase can be stopped, and the view can be put away.** One control
   from the first byte to the first finished frame. A started card collapses
   back to its still form.
4. **A view names what it shows.** Highlights, one storey and an isolated set
   are one view description. The isolated set takes the filter the agent
   already writes for `ifc_query` and for a highlight group (`ifc_types`,
   `storeys`, `name_contains`, or ids). The card, the model link and
   `show_in_viewer` read the same description. „Zeig mir nur die Stiegen“
   becomes a card whose view isolates the stair types.
5. **Each phase is recorded, finished or not.** Download, element list, build,
   GPU upload and finish each report their duration, and a load that is
   stopped, fails or is left reports the phase it was in. This is what decides
   B and C later.

**Geometry stays in the browser.** ADR-0045 stands. Option B is rejected on the
measurement above, and its trigger is restated under More Information with a
number.

### Consequences

* Good, because a person is never made to wait for, or pay bandwidth for, a
  picture they did not ask to see, and can stop one they did.
* Good, because two cards in one conversation, or a card and the model view,
  stop competing for the kernel. Today the single-threaded path refuses a
  second build while one runs
  (`GeometryProcessor processStreaming cannot start while …`), which a second
  card would meet as a load error. Read in the library, not reproduced.
* Good, because "only the stairs" needs no new geometry format: isolation is a
  renderer state, and the kernel builds a 49 MB model in under a second.
* Good, because the next report of "minutes" comes with the phase it happened
  in.
* Bad, because the element is no longer on screen the moment the answer lands.
  KAN-39 fixed the card vanishing so that the person sees the model; now they
  see a card that offers it. The legend and counts soften this; a still image
  would close it, and there is no server-side renderer for one today.
* Bad, because the store keeps a model's meshes in memory for the life of the
  page (13 MB for the 49 MB model). It needs an eviction rule for a second and
  third model.
* Bad, because this does not explain the customer's minutes. If they come from
  the GPU phases or from one difficult model, the customer still waits after
  pressing the button, though now by choice and with a way out.
* Neutral, because isolation hides elements and does not skip loading them. A
  person with a slow connection still downloads the whole file to see the
  stairs.

### Confirmation

Nothing enforces this yet; review is the only gate. What should:

* A spec in `ui/features/cards` that renders an `ifc_viewer` card and asserts
  no request for the model's source or elements before the press.
* A spec on the store that mounts two views of one model and asserts one
  download and one build.
* A seam rule that only the store imports `@ifc-lite/geometry`, so a new view
  cannot start a private load.
* The phase events documented in `docs/observability/posthog-events.md`, with a
  saved PostHog insight for p90 per phase.

## Pros and Cons of the Options

### A. One load per page, on request, measured

* Good, because every part of it answers something read in code.
* Good, because it is the same rule as ADR-0144, so the chat behaves one way.
* Bad, because it is an interface change to a card that KAN-39 just made more
  visible.

### B. Prepared geometry at upload

The `bim_extract` job would build meshes with the same kernel (it starts in
Node; verified in the timing run), store them in parts by storey and type
beside the other `_bim/` artefacts, and the browser would fetch parts and hand
them to `renderer.addMeshes`.

* Good, because the download shrinks: 2.4 MB of gzipped meshes against a
  49.3 MB file, and a part for the stairs alone is about 1 MB raw.
* Good, because the browser stops parsing IFC at all.
* Bad, because the build it removes takes 0.7 s for a 49 MB model on one
  thread. Premise: the timing table above, four models, `@ifc-lite/geometry`
  7.7.0. A model that takes the kernel tens of seconds would change this.
* Bad, because it adds a derived artefact that must be rebuilt when the kernel
  changes, a backfill for every stored model, and an encoder of our own: the
  library ships decoders for its packed formats and no JavaScript encoder
  (7.7.0).
* Bad, because it would not have helped if the minutes are in the GPU phases.

### C. Cross-origin isolation for the worker pool

* Good, because the build leaves the main thread.
* Bad, because the longest main-thread block measured without it is 0.2 s.
  Premise: the same table.
* Bad, because `Cross-Origin-Embedder-Policy` constrains every cross-origin
  resource the workspace loads, and the package's worker build has already
  broken a production build once (`docs/contributing/gotchas.md`,
  `geometry.worker.ts`).

### D. Fewer cards through the skill

* Bad, because the same load still starts unasked whenever a card does appear,
  and it works against KAN-5's goal that a person sees what they asked about.

### E. Only a cancel button

* Good, because it is one small change.
* Bad, because the load still starts unasked and still repeats per card.

## More Information

**Revisit B** when the phase events show the build phase at p90 above 5 s, or
the download phase at p90 above 20 s, on prod over two weeks with at least 50
loads. Revisit C when the longest main-thread block in the build phase passes
1 s at p90.

**Open before this is accepted.**

* The customer's model and browser. Without them the minutes stay unexplained;
  the phase events are the fallback.
* Whether prod really takes the single-threaded path:
  `self.crossOriginIsolated` in the console on the workspace. Expected `false`;
  the repo sets no `Cross-Origin-Embedder-Policy` for it.
* A browser trace of the GPU upload and the finishing pass for the 49 MB model.
* Whether the minutes are the answer and not the picture: `ifc_measure` runs
  IfcOpenShell over the file, and `packages/ifc-spatial-py/CORPUS.md` records a
  208 s geometry pass for one 22 MB model.
* A still image for the card, which needs a server-side render. Its own
  decision.
* Whether the source bytes are also kept across page loads (Cache Storage,
  cleared at sign-out). Its own decision; the store makes it a small one.

**PR #1604** (KAN-68) changes the same load hook and adds the load-failure
event; it lands first.

The timing script and its output are in the session notes for KAN-95; the
models are numbers 01, 03, 04 and 07 of `packages/ifc-spatial-py/CORPUS.md`.
