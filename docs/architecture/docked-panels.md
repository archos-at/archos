# Docked panels: a panel beside the real page

A docked panel sits **beside** the page, never over it and never with a copy of
the page inside it. Today one panel docks: the file peek beside the chat
(`FilePreviewBridge`, at the page's end edge).

[ADR-0148](../adr/0148-a-list-is-worked-beside-the-real-surface-never-a-copy.md)
introduced the primitive for a second use, the Postfach docked at the page's
start edge. That dock was removed (KAN-85): the Postfach opens from the bell
beside the person (`InboxBell`) as a glance, and is a page of its own at
`/app/inbox` (`InboxWorkspace`). The start dock, its store, the
shell's `startDock` slot, `PageDialog` and the `--page-inset-start` /
`--page-inset-top` variables went with it. Whether the ADR is superseded is the
ADR's to say.

## The pieces

| Piece | Where | What it owns |
|---|---|---|
| `DockedSplit` | `apps/workspace/ui/components/ui/docked-split.tsx` | A page with a panel docked at its `start` or `end` edge: the same tree open or not, expand then resize, the row glided open and shut, constant bounds, the width committed once per gesture, dragged shut means dismissed, double-click restores the default width, the restore tab |
| The file peek | `apps/workspace/ui/features/documents/components/file-preview-host.tsx` — `FilePreviewBridge` | The one docked panel: the file preview at the chat's end edge (`side="end"`); read it before docking another |

## Docking a panel

1. **Keep the page the split's child, open or not.** `DockedSplit` keeps the
   page the first panel's child either way; a conditional wrapper remounts the
   page and loses its drafts.
2. **Let it arrive, not jump.** `DockedSplit` glides the whole row both ways:
   the page's and the panel's shares (`flex-grow`) and the seam's width move
   from the row as it stood to the library's new layout, eased on the motion
   kit's entrance and exit tokens, while the panel's content keeps its open
   width and slides in or out under the group's clip. The page column resizes
   with it frame by frame, so a centred chat never steps sideways; a transform
   cannot do that, because the composer's own width changes. Closing keeps the
   real panel in the row, inert, until the glide ends. The glide is held at
   its first keyframe for one painted frame and its clock starts on the next
   (`gotchas.md`, search `stale time`), so a slow commit cannot eat its start. Under reduced motion, or
   with `slide={false}` for an open the reader did not make, the row changes
   once. Add no entrance of your own on top. `docked-split.spec.tsx` holds
   both directions.
3. **Mount shut at width 0.** `DockedSplit` declares `defaultSize` 0 when it
   mounts shut; the reason is in [`gotchas.md`](../contributing/gotchas.md)
   (search `file-ask-page`).

## What not to do

* **Do not draw the page's surface in the panel.** No thread, chat or preview
  re-implemented beside the page: open the real one. A copy lacks half of its
  original and drifts from it on the first change.
* **Do not move a panel in the DOM to dock it.** The file preview's panel is
  one element across parked, peek and modal; a portal remounts it.
