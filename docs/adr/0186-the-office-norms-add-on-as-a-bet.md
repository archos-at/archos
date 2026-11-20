---
status: proposed
date: 2026-11-19
decision-makers: the product owner
consulted: engineering (knowledge area)
informed: everyone who builds on the office shelf and base knowledge
---

# The office-norms add-on as a bet

## Context and Problem Statement

ADR-0163 lets an office hold norms of its own beside the platform's records: the Büroablage tab
„Normen & Richtlinien“, one upload with norm recognition and the norm dialog, norms from projects
(ADR-0185) and norms found in ordinary folders. The platform carries what is binding and public
(OIB guidelines, building codes, the editions it lists). The add-on carries what the platform does
not: paywalled ÖNORM, EN and DIN norms, and an office's own directives and commentaries.

Nobody knows yet whether offices will keep their norms there. VISION.md, „Staying necessary“,
asks that such a bet be judged as a seed bet, with its criteria, resources and decision date
written down before it starts, so it is neither killed early nor funded forever.

## Decision Outcome

The add-on ships behind the `office-standards` flag as a bet, judged as below.

**Who decides, and when.** The product owner, six weeks after the flag is on for the first beta
office. The flag is switched in WorkOS, which tells the code nothing, so the day it is switched on
and the resulting decision date are recorded here, under „Decision date“, in the same pull request
that sets this record's status.

**The criteria**, over the flagged offices, from the PostHog events
([`posthog-events.md`](../observability/posthog-events.md)) and, for the norms an office holds, its
records. The thresholds are proposed, for the product owner to set before the flag goes on:

| Criterion | Measured by | Proposed threshold |
|---|---|---|
| Offices that hold norms | share of flagged offices with ≥ 3 confirmed norms (the office's confirmed base-knowledge entries) | ≥ 50% |
| Dialog precision | `confirmed / (confirmed + not_norm)`, summed over `norm_dialog_settled` | ≥ 0.85 |
| „Später“ that stays undecided | rows `norm_dialog_settled` counted `later` whose norm is still waiting at the decision date (a Büroablage entry still proposed, a project offer still on the banner) | ≤ 30% |
| Answers that carry office norms | `office_norm_cited` against `answer_finished` in the same offices; `answer_completed`'s `office_norm_citations` says how many of those answers cited one | ≥ 20% carry one |
| Would they miss it | „How disappointed would you be if this disappeared?“, asked of the beta offices | ≥ 40% „very disappointed“ |

`norm_recognized_at_upload` (recognised against plain files per upload) and `norm_unlisted` /
`norm_relisted` are read beside them: how often recognition fires at all, and how often a person
takes a norm back.

**Resources.** No dedicated team. The add-on is maintained within the knowledge area, beside the
platform's records it shares.

**What „kill“ means.** The flag stays off and the tab disappears. The data model stays: the office's
works and editions are the platform's own records (ADR-0163), so nothing is dropped or migrated.

**The Postfach rule this add-on follows.** The Postfach holds only items that need a person's
decision: a suggestion for the Büroablage (`office_shelf.norm_suggested`), and a held norm that is
no longer the binding edition for an active project (`base_knowledge.new_edition`). State lives
where the thing is: norms found in a folder are shown in that folder, a project's norms on its
banner and in the dialog its upload opens, the waiting norms in the Normen tab. No roundup either.
So `office_shelf.norms_found` and `office_shelf.norm_offered` were removed before they shipped,
with the folder scan job and the settle hook that only existed to send them.

### Consequences

* Good, because the bet has a date and numbers before it starts, and a kill that costs only a flag.
* Good, because the Postfach stays a list of decisions, which keeps it worth opening.
* Bad, because a norm found in a folder is seen only by someone who opens that folder.
* Bad, because `office_norm_cited` counts what an answer could cite, and only the browser's
  `answer_completed` sees what it did cite, so an answer nobody watched counts in the first and
  not the second.

### Confirmation

Nothing enforces the decision date: the product owner records it here. The events have specs that
fail when they stop firing with their properties (`norm-reading.spec.ts`, `service.spec.ts`,
`norm-dialog-telemetry.spec.ts` and the dialogs' specs). `inbox-vocabulary.ts` holds the Postfach
types; a new type is reviewed against the rule above.

## Decision date

The flag on for the first beta office: not yet. Decision: six weeks after that day.
