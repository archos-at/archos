---
status: proposed
date: 2026-11-22
decision-makers: the product owner
consulted: support ticket 12 of 2026-11-20 (KAN-95); KAN-5 and KAN-39 on seeing the element one asked about
informed: everyone working on the answer cards and the BIM skill
---

# A model card starts its 3D view on request

## Context and Problem Statement

A customer on prod reported that the model view beside an answer runs for
several minutes and cannot be interrupted, and asked to suppress it (KAN-95).

What they see is the `ifc_viewer` answer card. The BIM skill makes it the
default for a measured answer („The card is the default, not an extra“,
`packages/agent/src/agent/skills/builtin/bim/ifc-spatial-reasoning/SKILL.md`),
and the card mounts a live 3D viewer the moment it is rendered
(`apps/workspace/ui/features/cards/components/IfcViewerCard.tsx`). So a
question about the model starts a download of the whole file and a geometry
build that the person did not ask for, in the answer they are reading.

The same chat already has the opposite rule. Under ADR-0144 the agent's
`focus_ifc_element` never opens the model view by itself; it waits for
„Anzeigen“. KAN-39 went the other way for the card: it fixed the card vanishing
on short answers, so that a person who asks about an element sees it.

This record decides only when the card's 3D starts. How a model is loaded and
stopped is ADR-0188; what a view may show is ADR-0189. Both hold whichever
option is chosen here.

## Decision Drivers

* The person decides what is on their screen, and what their connection and
  their machine are spent on.
* A person who asked about a building element sees it without typing a second
  question (KAN-5, KAN-39).
* One rule in one chat. A card and a viewer action that show the same model
  should not differ in whether they wait for the person.

## Considered Options

* **A. The card arrives as a still card and starts 3D on a press.**
* **B. The card starts 3D by itself, as today.**
* **C. The card starts 3D by itself once it scrolls into view.**
* **D. Keep B and tell the agent to attach the card less often.**

## Decision Outcome

Chosen option: **A**, because it is the rule ADR-0144 already set for the model
view in this chat, and it is the only option under which a person never waits
for, or pays bandwidth for, a picture they did not ask to see.

An `ifc_viewer` card arrives with its title, its legend of highlight groups
with counts, its note, „Modell öffnen“ and „3D-Ansicht laden“. Nothing of the
model is requested before that press. The press is the person's, as „Anzeigen“
is in ADR-0144.

### Consequences

* Good, because the customer's request, to suppress the view during a
  question, is the default.
* Good, because a conversation with five model answers costs no model load
  until the person wants one.
* Bad, because the element is no longer on screen the moment the answer
  lands. KAN-39 made the card stay so that the person sees the model; now they
  see a card that offers it. The legend and counts soften this. A still image
  of the highlighted elements would close it, and there is no server-side
  renderer for one today.
* Bad, because the "Zeig mir …" questions of the model test set (KAN-30) now
  need one press to pass as a person would judge them.

### Confirmation

Nothing enforces this yet; review is the only gate. What should: a spec in
`apps/workspace/ui/features/cards` that renders an `ifc_viewer` card and
asserts no request for the model's source or its elements before the press.

## Pros and Cons of the Options

### B. Starts by itself, as today

* Good, because the element is on screen with the answer.
* Bad, because it is the behaviour the customer reported, and it contradicts
  ADR-0144 in the same chat.

### C. Starts when in view

* Good, because cards further up a long conversation cost nothing.
* Bad, because the newest answer is always in view, so the reported case is
  unchanged.

### D. Fewer cards through the skill

* Bad, because whenever a card does appear the load still starts unasked, and
  it works against KAN-5's goal that a person sees what they asked about.

## More Information

Revisit when a still image for the card exists: with a picture already on the
card, the press becomes a step from picture to 3D, and the first "Bad, because"
goes away.

A per-person switch („3D automatisch laden“, like „Automatisch öffnen“ in
ADR-0144) was not considered as an option of its own. It is option A with a
setting on top and can be added without changing this record.
