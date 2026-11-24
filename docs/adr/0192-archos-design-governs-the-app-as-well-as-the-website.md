---
status: accepted
date: 2026-11-22
decision-makers: product owner
consulted: the capability census of 2026-11-22 (eight read-only passes over the workspace, `docs/product/capabilities.md`)
informed: everyone who builds a surface in the workspace or on the website
---

# ARCHOS Design governs the app as well as the website

## Context and Problem Statement

The design system 3.0 (ARCHOS Design: `packages/brand/`, its README and
`tokens.json`) was written for the website: square shapes, 4px controls, no
shadows, no signal colours, General Sans at 500, one light grey. The workspace
took it on „with a lighter hand“ and kept a shape language of its own:
`docs/design/design-language.md` § „Paper on a desk“ (2026-11-10) states that it
supersedes the brand for the app, and `tokens.json` carries app-only tokens for
it (`shadow-raised`, `shadow-floating`, `shadow-modal` and the radius ladder
`radius-inline` … `radius-full`). The app shows sheets with shadows at radius
10 and ochre, red and green as status colours, all of which ARCHOS Design rules
out.

The census of 2026-11-22 found the product reads as separate features rather
than one workspace. Two visual languages, one for the site a customer meets
first and one for the app they then work in, are part of that.

## Decision

ARCHOS Design is the one design system, for the app as for the website. Where
the app needs something a website does not (dense lists, the rail, states that
need the reader, the proposal ARCHOS makes), that is added to ARCHOS Design as
its app part, under its rules, not kept as a layer that overrides them.

## Consequences

* `design-language.md` § „Paper on a desk“ and every rule it supersedes stop
  being the reference for new work. A new or reworked surface follows ARCHOS
  Design; the existing surfaces move in the migration.
* The app-scoped shadow and radius tokens in `packages/brand/tokens.json` are
  retired by the migration, and the specs that hold the current material
  (`apps/workspace/tests/brand-literals.spec.ts`,
  `apps/workspace/ui/components/shell/app-rail-material.spec.ts`) change with
  it, in the same pull requests.
* Status colour is the open question ARCHOS Design does not yet answer: it has
  one colour with a function, `markup`, for findings. The app part has to say
  how „failed“, „done“ and „waits for you“ read without hue, or name the one
  exception, before the migration reaches lists and badges.
* Every surface the migration changes is customer-visible and gets its
  before-and-after capture on the pull request
  ([`visual-screenshots.md`](../ux/visual-screenshots.md)).

### Confirmation

Nothing enforces it yet. Today's specs hold the old material
(`brand-literals.spec.ts`, `app-rail-material.spec.ts`); each migration pull
request rewrites the spec of the surface it moves so that it holds ARCHOS
Design instead, and the last one removes the app-scoped tokens, after which
`scripts/check_brand_rules.mjs` can refuse a shadow in the app as it does on the
website. Neither the website check nor any app check limits a radius yet.
