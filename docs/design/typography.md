# Typography: one ramp of roles

**Status: proposed 2026-11-11, not yet in the code.** Until slice 1 lands, the
numbers in [`design-language.md`](design-language.md) („Hard numbers“, „Type
ramp“, „One type ramp, one scale“) are what the code and
`apps/workspace/tests/brand-literals.spec.ts` hold. This document replaces all
three when it is accepted; the slices below say in which order.

## The star

A person opening any screen of the workspace can tell at a glance what a thing
is called, what is said about it and what is only a fact beside it, and the
answer is the same on every screen. Whoever builds a surface chooses what a
piece of text *is* and never picks a size, a weight or a grey.

## What was measured

Counted over `apps/workspace/ui` and `app` (specs and `/dev` left out), on
`develop` at 2026-11-11:

| Fact | Number |
|---|---|
| Distinct font sizes | 33, from 8.5px to 36px |
| Distinct size × weight × colour combinations in one class string | 91 |
| Size declarations | about 2,300; 1,143 `text-xs`, 766 `text-sm`, 57 `text-base` (85% are 12, 14 or 16px) |
| Declarations through a role token (`text-name`, `text-meta`, …) | 53, about 2% |
| Weights | 659 `font-medium`, 130 `font-normal`, 31 `font-semibold` |
| Text colour | 1,873 `text-muted-foreground`, 610 `text-foreground`, 55 with an alpha step (`/30` to `/90`) |
| Line heights | `relaxed` 153, `snug` 123, `leading-5` 40, `leading-4` 31, and 26 typed ratios or pixel values |
| Type ramps in `design-language.md` | 3, disagreeing: a page title is `text-xl font-medium` (20/500) in one and 24/32/600 in another; a mail subject is 18px in one and 20px in another |

Four causes follow from the numbers, each checked by rendering General Sans at
the sizes in question:

1. **The steps are too close.** Name 13px, body 14px and meta 12px are one
   pixel apart (8%), which reads as one size. The name is also smaller than the
   body text it heads.
2. **So are the weights.** 440 and 500 are 60 units apart in a face whose
   named steps are 100; at 12 to 14px the pair does not separate. Four in five
   weight declarations are 500, so weight carries almost no rank.
3. **Grey is the default.** Three times as much text is muted as is ink. When
   content is grey too, grey no longer says „beside the point“.
4. **The rules are not reachable.** The ramp exists as five tokens that 2% of
   the code uses; everything else composes `text-xs font-medium
   text-muted-foreground` by hand, and the documentation offers three answers.

## Three rules

1. **Roles, not sizes.** A role fixes size, line height and weight together.
   Code names the role; it never sets a size, a `leading-*` or a weight beside
   it. The one weight a call site may set is state on a `name` (below).
2. **Every step is visible.** Two neighbouring sizes differ by at least 14%,
   two weights by 100 units, and two ranks that stand next to each other differ
   in two of the three channels: size, weight, tone. This sharpens principle 3
   of the design language („rank by two channels“).
3. **Muted means beside the point.** What a person came to read is ink
   (`text-foreground`). Muted (`text-muted-foreground`) is for what describes a
   thing: a date, a size, an author, a hint. There are these two tones and no
   alpha steps; placeholder and disabled keep their own tokens.

## The ramp

Seven sizes (11, 12, 14, 16, 20, 24, 32), three weights (440, 540, 640), every
line height on the 4px grid except the reading text's.

| Role | Size / line / weight | Tone | What it is |
|---|---|---|---|
| `display` | 32/40/640 | ink | The one large moment of a page: the greeting in the empty chat, a stat's figure |
| `page-title` | 24/32/640 | ink | A page's title, once per page (`PageHeader`) |
| `pane-title` | 20/28/640 | ink | The title of an opened thing: a mail's subject, the document in the preview |
| `section` | 16/24/640 | ink | A group heading, a dialog's title, a card's title, an empty state's headline |
| `name` | 14/20/540 | ink | What a row is about: a file name, a subject, a person. Also the label of a button, a tab, a navigation item |
| `body` | 14/20/440 | ink; muted as the line under a heading | Sentences in the interface: a description, dialog text, a field's value |
| `label` | 12/16/540 | muted | Names a group or a field: a column head, a field label, the card eyebrow (`SectionLabel`) |
| `meta` | 12/16/440 | muted; ink only as a cell of a dense table | Facts about a thing: date, size, author, count, caption |
| `code` | 11/16/540 | either | A format code (PDF, DWG) and a count in a pill. Nothing else is smaller than 12px |
| `answer` | 16/26/440 | ink | Long text that is read, not scanned: the agent's answer, a mail's body |
| `mono` | Geist Mono 13/20/440 | ink | A string to copy: an address, an identifier, a § reference |

**State is weight, on `name` only**: 640 needs the reader, 540 waits on a
press, 440 is handled (the mail list's rule, unchanged in meaning). Tracking
stays 0 and capitals stay the wordmark's. Figures in a column are
`tabular-nums`. Headings inside an answer are `pane-title` and `section`.

## What changes against today

| Today | Proposed | Why |
|---|---|---|
| `text-name` 13/20/500 | 14/20/540 | 13 between 12 and 14 is no step; row heights (40, 56) stay |
| Weights 440 / 500 / 600 | 440 / 540 / 640 | 100 units between ranks; 700 stays the wordmark's |
| 11px „codes and counts“, used 82 times | `code`, codes and pill counts only | The rest are meta lines set too small |
| 10, 10.5, 9, 8.5px | 11 or 12 | Under the label floor the design language already names |
| 15, 17, 18, 22, 23px | 16, 20 or the role above | Sizes that express no rank |
| A mail's body 14px, `leading-relaxed` | `answer` | It is read like an answer |
| `text-foreground/NN`, `text-muted-foreground/NN` | one of the two tones | An alpha step is a third grey |

The brand's „weight 500 for all content“ (`packages/brand/README.md`) is a rule
for 44 to 96px display type. The app already departs from it with 440 and 600;
this moves the middle step for the same reason.

## Slices

Each names the part of the star it serves.

1. **Tokens and renaming, no pixel moves** (roles are reachable). Add `body`,
   `label`, `code` and `display` beside the five tokens in
   `apps/workspace/ui/styles/tokens.css` and to `TYPE_SCALE` in
   `apps/workspace/bff/utils.ts`. A codemod turns `text-xs` and `text-sm` into
   the role they already are (12/16 and 14/20 are Tailwind's own values), which
   covers 85% of the declarations.
2. **Weights** (every step is visible). `--font-weight-medium: 540` and
   `--font-weight-semibold: 640` in `tokens.css`, as `--font-weight-normal: 440`
   is set today, and the three title tokens. Two lines move about 690 call
   sites; capture the main surfaces before and after. `brand-literals.spec.ts`
   asserts 600 on the title tokens and changes with it.
3. **Fold the off-ramp sizes in, surface by surface** (the same answer on every
   screen). About 350 declarations: 13px, 11px used as meta, everything under
   11, 15 to 23px, typed line heights. Dateien and the E-Mail-Eingang first,
   then chat, review, settings. `text-name` becomes 14px here.
4. **Tone, and the ratchet** (grey means beside the point). Content to ink, the
   55 alpha steps gone. Then a per-file ratchet in the manner of
   `ci/size_baseline.json`: no raw `text-<size>`, no `font-<weight>` outside
   state on a name, no `leading-*` beside a role, no alpha on a text colour;
   the count may only shrink. The three ramps in `design-language.md` become a
   pointer to this document.

## Open decisions

- Dropping 13px reverses „every row's name is `text-name` 13/20/500“ from Paper
  on a desk (2026-11-10).
- 540 and 640 as the upper weights.
- A mail's body at 16px.
