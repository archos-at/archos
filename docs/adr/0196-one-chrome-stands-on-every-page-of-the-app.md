---
status: accepted
date: 2026-11-24
decision-makers: product owner (Matthias)
consulted: the phone navigation audit of 2026-11-24 (measured on the local stack at 390 and 360px)
informed: everyone who builds a page under `/app`
---

# One chrome stands on every page of the app

## Context and Problem Statement

The app had two chromes. Inside a side (a project, or Persönlich) the rail stood
on a desktop, and on a phone the tab bar and „Mehr". Above the sides (the project
overview, the Postfach, the search, the Bürobibliothek, the profile, the
organisation, the platform, „Neuerungen", „Mein Gedächtnis") a top bar
(`OrgHeader`) stood instead, with a tab bar of its own: „Projekte |
Bürobibliothek | Postfach", and no „Mehr".

The audit measured what this did on a phone. Opening „Profil" or „Organisation"
from „Mehr" swapped the whole chrome: a bar appeared over the page, the tabs
changed from five to three with none lit, the layout shifted by 0.08, and the
only way back to Persönlich or the project was the browser's Back. Four pages
kept the chrome they were opened from (`KEEPS_THE_COVERED_CHROME`) through a
value held in memory, so the same address showed the project's tabs when
reached from a project and the top bar after a reload. The rail's avatar menu
had also drifted from the top bar's: only the top bar's could switch the office.

## Decision Drivers

* A person always has the same ways out: the rail, or the tab bar and „Mehr".
* The address alone decides what stands; a reload never changes the chrome.
* Moving between two pages swaps the page, never the chrome.
* No new rows in the rail.

## Considered Options

* Keep two chromes, and make the org pages' tab bar carry „Mehr" and the side switch.
* One chrome on every page, on the side the person was last on.

## Decision Outcome

Chosen option: one chrome on every page, because the swap itself was the fault;
patching the second chrome would have kept two ways to get around.

1. **Every page under `/app` stands in the same chrome**: `AppShellChrome` always
   draws `AppSidebar`, the `PhoneTabBar` and `PhoneMoreSheet`. `OrgHeader`, the
   org tab set and `KEEPS_THE_COVERED_CHROME` are gone.
2. **A page with no side of its own keeps the side the person was last on**
   (`shell-side.ts`). The server reads it from the `last_place` cookie, so the
   first paint is right; the cookie now records only a side's pages, and a
   project the person can no longer open falls back to Persönlich. While the
   person moves between such pages, the side they came from stays.
3. **On such a page nothing of the side is lit** (`AppSidebar`'s `onSide`):
   the side's sections, its recorders and the phone's back line stand down.
   The matching doorway lights where one exists: the bell on the Postfach, the
   magnifier on the search, the Bürobibliothek in the rail; on a phone the
   Postfach tab, or „Mehr" for what „Mehr" leads to. The organisation's and the
   platform's pages keep their own navigation in the page.
4. **The wordmark opens the project overview**, as its label always said, from
   either side.
5. **The account is one value** (`shell-account.ts`): the rail's avatar menu and
   „Mehr" get the same person, office, offices and rights.
6. **The welcome tour points at the rail on a desktop and at the tab bar and
   „Mehr" on a phone.**

### Consequences

* Good, because a phone always has the tab bar and „Mehr", and so the side
  switch, the project list and the account.
* Good, because the chrome never remounts: a spec counts the rail's mounts
  across project → Postfach → Suche → Organisation → Persönlich.
* Bad, because the wide organisation and platform pages give the rail its width
  on a desktop; the rail folds to 64px as everywhere else.

### Confirmation

`app-shell-chrome.spec.tsx` (one chrome, no remount, the kept side, the side
from the server), `shell-side.spec.ts`, `last-place.spec.ts`,
`shell-account.spec.tsx`, `product-tour.spec.ts` (the tour's anchors), and the
phone gate (`apps/workspace/scripts/phone-audit.mjs`) at 390 and 360px.

## More Information

The rail's design: [`design-language.md`](../design/design-language.md#the-app-rail).
