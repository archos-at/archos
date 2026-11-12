# Typography: one ramp of roles

**Status: proposed 2026-11-12 (second version), not yet in the code.** It
stands on the values of two open changes, the lighter rail
([#1617](https://github.com/archos-at/archos/pull/1617)) and the one header
anatomy ([#1681](https://github.com/archos-at/archos/pull/1681)), and changes
none of them. Until slice 1 lands, the numbers in
[`design-language.md`](design-language.md) („Hard numbers“, „Type ramp“, „One
type ramp, one scale“) are what the code and
`apps/workspace/tests/brand-literals.spec.ts` hold. This document replaces all
three when it is accepted.

The first version (2026-11-11) proposed 14px names, weights 440/540/640 and
24px page titles. The owner's corrections of the same days went the other way
(„zu groß und zu massiv“, „die Headline ist zu dick“), so that version is
withdrawn: the app is light, and rank comes from size and tone.

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
| Size declarations | about 2,300; 1,143 `text-xs`, 766 `text-sm`, 94 `text-[13px]`, 57 `text-base` |
| Declarations through a role token (`text-name`, `text-meta`, …) | 53, about 2% |
| Weights | 659 `font-medium`, 130 `font-normal`, 31 `font-semibold` |
| Text colour | 1,873 `text-muted-foreground`, 610 `text-foreground`, 55 with an alpha step (`/30` to `/90`) |
| Line heights | `relaxed` 153, `snug` 123, `leading-5` 40, `leading-4` 31, and 26 typed ratios or pixel values |
| Type ramps in `design-language.md` | 3, disagreeing with each other |

What follows from them:

1. **The direction is set, the rule is not written.** The rail and the headers
   are consistent in themselves. Every other surface still composes `text-xs
   font-medium text-muted-foreground` by hand, and the documentation offers
   three answers.
2. **440 and 500 do not separate on their own.** Rendered in General Sans at 12
   to 14px the pair is too close to carry a rank. The rail already does the
   right thing: at rest 440 and muted, current 500 and ink.
3. **13px and 14px stand side by side unexplained.** Rows and the rail are
   13px; the kit's buttons, tabs, menus, fields and labels are 14px
   (`ui/components/ui/`). The design language says „13/20/500 names and
   controls“, which the controls do not follow.
4. **Grey is the default.** Three times as much text is muted as is ink.

## Four rules

1. **Roles, not sizes.** A role fixes size, line height and weight together.
   Code names the role and sets no size, `leading-*` or weight beside it,
   except state on a `name` (below).
2. **Light is the normal case.** Rank comes from size and tone. A title is 500.
   600 has two uses: the 16px section heading, which size alone does not lift
   off 14px body, and what needs the reader. (The one older exception stays:
   numerals and initials at 12px or less inside a fill.)
3. **Weight never changes alone.** At rest is 440 and muted; named or current
   is 500 and ink. Where the reader is, the sheet behind the row says it too.
4. **13 is the index, 14 is the page.** Text that points at a thing and stays
   on one line is 13px: a rail row, a file name, a subject in a list, a crumb, a
   count beside a title. What a person presses or reads is 14px: a button, a
   tab, a menu item, a field, a sentence. The two never rank against each
   other.

Tone has two values, ink (`text-foreground`) and muted
(`text-muted-foreground`), and no alpha steps; placeholder and disabled keep
their tokens. What a person came to read is ink.

## The ramp

Eight sizes (11, 12, 13, 14, 16, 18, 20, 24), three weights (440, 500, 600).
Every value except `display` is already in the code or in the two open changes;
new are the names for roles that had none.

| Role | Size / line / weight | Tone | What it is | Token today |
|---|---|---|---|---|
| `display` | 24/32/500 | ink | The one large moment: the greeting in the empty chat (23px today), a stat tile's figure (`text-2xl`) | none |
| `page-title` | 20/28/500 | ink | A page's title, every `h1`; 16/24/500 on a phone | `text-page-title` (#1681) |
| `pane-title` | 18/26/500 | ink | The title of an opened thing: a mail's subject, a dialog's title (`text-lg` today) | `text-pane-title` (#1681) |
| `section` | 16/24/600 | ink | A group heading, a card's title, an empty state's headline | `text-section` |
| `control` | 14/20/500 | ink; muted for the unchosen tab | What is pressed or chosen: a button, a tab, a menu item, a field's label | none (`text-sm font-medium`) |
| `body` | 14/20/440 | ink; muted as the line under a heading | Sentences and field values; 22px line for a paragraph that is read | none (`text-sm`) |
| `name` | 13/20/500 | ink; muted at 440 at rest | An entry in an index: a rail row, a file name, a subject, a crumb, a count beside a title | `text-name` |
| `label` | 12/16/500 | muted | Names a group or a field: „Letzte Chats“, a column head (`SectionLabel`) | none (`.card-eyebrow`) |
| `meta` | 12/16/440 | muted | Facts about a thing: date, size, author, caption | `text-meta` |
| `code` | 11/16/500 | either | A format code (PDF, DWG) and a count in a pill. Nothing else is under 12px | none |
| `answer` | 16/26/440 | ink | The agent's answer | `text-answer` |
| `mono` | Geist Mono 13/20/440 | ink | A string to copy: an address, an identifier, a § reference | none |

**State on `name`**: 600 needs the reader, 500 is named or current, 440 muted
rests or is handled. Tracking stays 0, capitals stay the wordmark's, figures in
a column are `tabular-nums`.

## What changes against the two open changes

Nothing they set. Three things they leave open:

- #1617 sets the rail's rows as `text-[13px] font-normal` where it took
  `text-name` away, because the token carries 500. Slice 1 writes them as
  `text-name font-normal`, the role with its resting state.
- On a phone the page title is 16/24/500 and so stands under a 16/24/600
  section heading. Open decision below.
- The hero greeting stays 23px there. `display` proposes 24px so it shares a
  role with the stat figure.

## Slices

1. **Tokens and renaming, no pixel moves** (roles are reachable). Add `label`,
   `body`, `control`, `code` and `display` in
   `apps/workspace/ui/styles/tokens.css` and to `TYPE_SCALE` in
   `apps/workspace/bff/utils.ts`. A codemod turns `text-xs`, `text-sm` and
   `text-[13px]` into the role each already is; that is about 90% of the
   declarations.
2. **The kit first** (the same answer on every screen). The primitives in
   `ui/components/ui/` (button, tabs, dropdown-menu, input, select, dialog,
   table, badge, tooltip, label, chip, command) set roles; about fifteen files
   decide most of what is seen. The dialog title becomes `pane-title` (its line
   goes from 28 to 26px).
3. **Fold the off-ramp sizes in, surface by surface.** About 250 declarations:
   9, 10 and 10.5px to 11 or 12; 15 and 17px to 14 or 16; everything over 20px
   to `display`; 11px kept for codes and pill counts only; typed line heights
   gone. Chat, review and settings first: they still carry the rules from
   before Paper on a desk.
4. **Tone, and the ratchet** (grey means beside the point). Content to ink, the
   55 alpha steps gone. Then a per-file ratchet in the manner of
   `ci/size_baseline.json`: no raw `text-<size>`, no `font-<weight>` outside
   state on a name, no `leading-*` beside a role, no alpha on a text colour;
   the count may only shrink. The three ramps in `design-language.md` become a
   pointer to this document.

## Open decisions

- **13 for the index, 14 for the page** describes what the code does. The
  alternative is 13px for buttons, tabs and menus too: lighter still, and it
  moves every surface.
- **The greeting at 24 instead of 23px.**
- **The phone's page title**: either the section heading is 14/600 on a phone,
  or the title stays 18px there.
