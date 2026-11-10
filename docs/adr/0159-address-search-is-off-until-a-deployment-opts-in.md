---
status: accepted
date: 2026-11-10
decision-makers: engineering
consulted: the country base knowledge design review (docs/design/international/design.md 2.2, defect 9)
informed: operators of every stack
---

# Address search is off until a deployment opts in; amends ADR-0151

## Context and Problem Statement

ADR-0151 made komoot's public Photon the default geocoder: `geocoderUrl`
defaulted to `https://photon.komoot.io` in Pulumi, and Compose fell back to it.
The project dialog sends every keystroke of an address search to that host. It
is a processor in no sub-processor register, and a default sends an office's
addresses there without anyone having decided to.

## Decision Drivers

- Data a person types leaves the cell only through a processor someone chose
  and registered.
- Address search is a convenience: without it, the typed address is kept and
  stored as unconfirmed (ADR-0158), and the Bundesland is found in the
  documents or asked.

## Considered Options

- **Keep komoot as the default.** Rejected while komoot is in no processor
  register; the data-flow register (build split S5) is where it gets one.
- **Default off; a stack opts in by naming the geocoder.** Chosen.
- **Self-host Photon again (ADR-0120).** Rejected for now for the reason
  ADR-0151 gave: a workload for a convenience. Address resolution from official
  registers in the cell is the later answer (design 5.3, `site-resolve`).

## Decision Outcome

Chosen option: default off, because no address should leave the cell by default.
`geocoderUrl` defaults to empty in `deploy/pulumi/src/config.ts`
(`PUBLIC_GEOCODER_URL` stays the named value a stack sets to opt in), and
Compose passes `${GEOCODER_URL-}`. Everything else of ADR-0151 stands.

### Consequences

- Good, because no keystroke reaches komoot unless an operator set it.
- Bad, because the next deploy of a stack that relied on the default turns
  address search off until its config names the geocoder; the dialog then keeps
  the typed address as unconfirmed.

### Confirmation

`deploy/pulumi/src/config.spec.ts` ("is off by default") and
`deploy/pulumi/index.spec.ts` (no workload gets `GEOCODER_URL` by default).

## More Information

Revisit when the data-flow register lists komoot (build split S5), or when
address resolution from registers in the cell replaces the geocoder.
