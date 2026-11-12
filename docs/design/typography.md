# Typography: one ramp of roles

**Status: accepted in its numbers 2026-11-12 (third version), not yet in the
code.** The owner decided the three open points the same day: the whole
interface is 13px, the greeting is 24px, and the phone's page title was left to
this document (18px). It stands on the values of two open changes, the lighter rail
([#1617](https://github.com/archos-at/archos/pull/1617)) and the one header
anatomy ([#1681](https://github.com/archos-at/archos/pull/1681)), and changes
one of them (the phone's page title). Until slice 1 lands, the numbers in
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
3. **13px and 14px stood side by side unexplained.** Rows and the rail are
   13px; the kit's buttons, tabs, menus and labels were 14px
   (`ui/components/ui/`), against the design language's „13/20/500 names and
   controls“. Decided 2026-11-12: the controls follow to 13px.
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
4. **13 operates, 14 writes, 16 answers.** The interface is 13px: a rail row, a
   file name, a crumb, a button, a tab, a menu item, a field's label. Sentences
   and whatever a person types are 14px: a description, dialog text, a field's
   value, the person's message in the chat. 16px is the agent's answer and
   nothing else.

Tone has two values, ink (`text-foreground`) and muted
(`text-muted-foreground`), and no alpha steps; placeholder and disabled keep
their tokens. What a person came to read is ink.

## The ramp

Eight sizes (11, 12, 13, 14, 16, 18, 20, 24), three weights (440, 500, 600).
Eleven roles.

| Role | Size / line / weight | Tone | What it is | Token today |
|---|---|---|---|---|
| `display` | 24/32/500 | ink | The one large moment: the greeting in the empty chat (23px today), a stat tile's figure (`text-2xl`), an answer's key figure | none |
| `page-title` | 20/28/500 | ink | A page's title, every `h1`; 18/26/500 on a phone | `text-page-title` (#1681) |
| `pane-title` | 18/26/500 | ink | The title of an opened thing: a mail's subject, a dialog's title (`text-lg` today) | `text-pane-title` (#1681) |
| `section` | 16/24/600 | ink | A group heading, a card's title, an empty state's headline | `text-section` |
| `body` | 14/20/440 | ink; muted as the line under a heading | Sentences and what a person types: a description, dialog text, a field's value, the message in the chat; 22px line when it runs over lines; a field is 16px under a finger | none (`text-sm`) |
| `name` | 13/20/500 | ink; muted at 440 at rest | Everything of the interface on one line: a rail row, a file name, a subject, a crumb, a count beside a title, a button, a tab, a menu item, a field's label | `text-name` |
| `label` | 12/16/500 | muted | Names a group or a field: „Letzte Chats“, a column head (`SectionLabel`) | none (`.card-eyebrow`) |
| `meta` | 12/16/440 | muted | Facts about a thing: date, size, author, caption | `text-meta` |
| `code` | 11/16/500 | either | A format code (PDF, DWG) and a count in a pill. Nothing else is under 12px | none |
| `answer` | 16/26/440 | ink | The agent's answer; its first sentence at 500, its headings `section` | `text-answer` |
| `mono` | Geist Mono 13/20/440 | ink | A string to copy: an address, an identifier, a § reference | none |

**State on `name`**: 600 needs the reader, 500 is named or current, 440 muted
rests or is handled. Tracking stays 0, capitals stay the wordmark's, figures in
a column are `tabular-nums`.

## In the chat

Measured in the running app (`/dev/chat-turn`, `/dev/stream-replay`,
`/dev/shared-thread`, computed styles at 1440px, 2026-11-12): the person's
message is 14px on a 22.75px line, the composer's field 14px on 21.7px, the
answer 16px on 26px with its first sentence at 500, the reasoning line and the
sources 12px. The ramp keeps those sizes: the message and the field are `body`
on its 22px line, the answer is `answer`, the follow-ups and the composer's
presses are `name`. The answer is larger than the question on purpose: it is
what is read.

## What changes against the two open changes

- **The phone's page title is 18/26/500, not 16/24/500** (#1681). At 16/500 it
  stood under a 16/600 section heading; a 14/600 heading instead would be the
  size of the sentence under it. 18, 16, 14 keeps the ladder.
- #1617 sets the rail's rows as `text-[13px] font-normal` where it took
  `text-name` away, because the token carries 500. Slice 1 writes them as
  `text-name font-normal`, the role with its resting state.
- #1617 keeps menus at 14px and the kit's tabs are 14px. Both go to 13px with
  the kit (slice 2).
- The hero greeting goes from 23 to 24px (`display`).

## Slices

1. **Tokens and renaming, no pixel moves** (roles are reachable). Add `label`,
   `body`, `code` and `display` in
   `apps/workspace/ui/styles/tokens.css` and to `TYPE_SCALE` in
   `apps/workspace/bff/utils.ts`. A codemod turns `text-xs`, `text-[13px]` and a
   `text-sm` without a weight into the role each already is.
2. **The kit goes to 13px** (the same answer on every screen). The primitives
   in `ui/components/ui/` (button, tabs, dropdown-menu, select, table, badge,
   label, command) set `name`; field values stay `body`. About fifteen files,
   and the one slice every surface shows: capture before and after. The dialog
   title becomes `pane-title` (its line goes from 28 to 26px).
3. **Fold the off-ramp sizes in, surface by surface.** About 250 declarations:
   9, 10 and 10.5px to 11 or 12; 15 and 17px to 14 or 16; 23px and everything
   over it to `display`; 11px kept for codes and pill counts only; typed line heights
   gone. Chat, review and settings first: they still carry the rules from
   before Paper on a desk.
4. **Tone, and the ratchet** (grey means beside the point). Content to ink, the
   55 alpha steps gone. Then a per-file ratchet in the manner of
   `ci/size_baseline.json`: no raw `text-<size>`, no `font-<weight>` outside
   state on a name, no `leading-*` beside a role, no alpha on a text colour;
   the count may only shrink. The three ramps in `design-language.md` become a
   pointer to this document.
