---
status: proposed
date: 2026-11-22
decision-makers: engineering
consulted: support ticket 12 of 2026-11-20 (KAN-95), the wish to see only some elements
informed: everyone working on the model view, the answer cards, the BIM skill and `show_in_viewer`
---

# A model view is one description, and an isolated set is part of it

## Context and Problem Statement

A customer asked to see only some elements of a model, „zeig mir nur die
Stiegen“ (KAN-95). Today that gives the whole building with the stairs
coloured.

What a model view shows is described in three places that do not agree:

* The model link and the model view read `BimModelView`
  (`apps/workspace/ui/features/bim/lib/model-link.ts`): model, storey,
  element, highlights, x-ray, camera.
* The `ifc_viewer` card passes its own props to the viewer (highlights and one
  storey) and builds a `BimModelView` only for its „Modell öffnen“ link, where
  it adds x-ray that the card itself does not show
  (`apps/workspace/ui/features/cards/components/IfcViewerCard.tsx`).
* `show_in_viewer` with `focus_ifc_element` carries one GlobalId
  (`packages/agent/src/agent/tools/viewer/register.py`).

Isolation exists only as a person's click on one selected element
(`model-stage-helpers.ts`). No description carries it, so neither the agent
nor a link can ask for it. The agent already has the words for a set of
elements: `IfcElementMatch` (`packages/agent/src/agent/cards/ifc_cards.py`),
the `ifc_query` filter that a highlight group reuses, which the page turns
into a query in `matchToFilter`
(`apps/workspace/ui/features/bim/lib/card-highlights.ts`).

## Decision Drivers

* The card, the link behind it and the agent's viewer action show the same
  thing when they say the same thing.
* A set of elements is named by a filter, not by a list of ids. A list does
  not survive the model's context window, and a link holds at most 60 ids
  (`MAX_LINK_IDS`).
* The agent learns no second vocabulary for selecting elements.
* Nobody looks at part of a building believing it is all of it. The user
  guide keeps hidden elements out of the link for this reason
  (`docs/user-guides/bim-models.md`, "Every view is a link").

## Considered Options

* **A. One view description, owned by `model-link.ts`, with an isolated set that takes the `ifc_query` filter.**
* **B. An `isolate` field on the card only.**
* **C. The agent sends the isolated elements as a list of GlobalIds.**
* **D. A new card type for "only these elements".**

## Decision Outcome

Chosen option: **A**, because it is the only option under which a card and the
model view it links to cannot disagree, and it reuses the one filter the agent
already writes.

* `BimModelView` in `apps/workspace/ui/features/bim/lib/model-link.ts` is the
  one description of what a model view shows, and gains `isolate`: either the
  filter (`ifcTypes`, `storeys`, `nameContains`, `material`, `classification`,
  `properties`) or a short list of GlobalIds. The existing `storey` stays and
  combines with it, as hiding and isolating by hand do today.
* Every view is drawn from a `BimModelView`. The card stops passing its own
  props and renders the same description its link carries, x-ray included.
* The `ifc_viewer` card gains `isolate`, typed as `IfcElementMatch` or
  `global_ids`, exactly one, as a highlight group is. `show_in_viewer`'s model
  action maps into the same description through the same function as the
  card.
* The link encodes the filter itself, not the ids it resolves to.
* A view with an isolated set says so on the view, with what it is limited to,
  how many elements that is, and „Alles anzeigen“. This is what lets the set
  travel in a link where a person's own hidden elements do not.

„Zeig mir nur die Stiegen“ becomes a card whose view isolates
`ifc_types: [IfcStair, IfcStairFlight, IfcRailing]`.

### Consequences

* Good, because "only the stairs" needs no new geometry format: isolation is
  a renderer state.
* Good, because a link to a view reproduces it for a colleague, whatever the
  size of the set.
* Bad, because isolation hides elements and does not skip loading them. On a
  slow connection a person still downloads the whole file to see the stairs
  (ADR-0188 names what would change that).
* Bad, because the card's schema and the viewer action's arguments change.
  Both are generated from the agent's models
  (`apps/workspace/shared/cards/generated.ts`, the wire schema), and an older
  page must pass over a field it does not know, as ADR-0144 requires of a
  sixth action.
* Bad, because which IFC types "the stairs" are is left to the agent. A stair
  modelled as `IfcBuildingElementProxy` is missed, as it is by `ifc_query`
  today.

### Confirmation

Nothing enforces this yet; review is the only gate. What should:

* A spec that builds a view from a card, from its link after a round trip
  through the URL, and from the viewer action, and asserts the three
  `BimModelView` values are equal.
* A seam rule that only `model-link.ts` declares the view's shape, so a
  component cannot grow a private prop for what is shown.
* The card field in the registry spec that already holds every card type to
  its generated schema.

## Pros and Cons of the Options

### B. A field on the card only

* Good, because it is the smallest change that answers the customer.
* Bad, because „Modell öffnen“ on that card then opens a view that shows
  something else, which is the disagreement the x-ray flag already has.

### C. A list of GlobalIds

* Bad, because a storey's walls are hundreds of ids. Premise: the reason
  `IfcElementMatch` exists, stated in its own description, and the link's cap
  of 60.

### D. A new card type

* Bad, because it is the `ifc_viewer` card with one more field, and a second
  card type for the same picture gives the agent a choice with no difference
  behind it.

## More Information

Revisit when a view must show less than it loads (prepared parts per storey
or type, ADR-0188 option B): the isolated set would then also select what is
fetched, and this description is where that selection would be read from.

A person's own hide and isolate clicks stay outside the description, as
measurements do: they are working notes, and the user guide's "Every view is a
link" section says why. That section gains the isolated set when this lands.
