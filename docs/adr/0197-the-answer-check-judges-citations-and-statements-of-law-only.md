---
status: accepted
date: 2026-11-25
decision-makers: product owner
consulted: a review of how legal answer products show verification (Harvey, CoCounsel, Lexis+, Anthropic's Citations API, Google's check-grounding API), 2026-11-25
informed: everyone working on the answer pipeline or the confidence chip
---

# The answer check judges citations and statements of law only

## Context and Problem Statement

[ADR-0139](0139-confidence-is-a-groundedness-check-of-the-answer.md) made the
answer's confidence one model grading of the whole answer. Its prompt said „a
true statement the evidence does not state is unbacked", and the level read
„high: every statement the answer relies on is backed by the evidence". The
grader is handed the turn's passages, this turn's workspace records, the turn
context, measurements and readings. It is never handed the person's memory,
the earlier turns of the conversation, or most tool results. So every answer
that rests on those had findings by construction: „erstelle ein PDF mit allem
was du über mich weißt" came back with „2 Aussagen ohne Beleg" in the
Herleitung's header, about facts that were right and came from memory. The
product owner found the header useless: it warned on answers that were fine,
and so said nothing about the ones that were not.

## Decision Drivers

* A finding must be something the grader can actually decide. A statement
  whose source it was not shown is not unbacked; the grader simply cannot see.
* What the reader cannot check at a glance, and what does damage when wrong, is
  a cited source that does not say what the answer claims, and a statement of
  what a regulation requires with no source at all (ADR-0061, ADR-0125).
* Industry standard first (`AGENTS.md`). Harvey, CoCounsel and Lexis+ verify
  citations against their sources; none shows an answer-level confidence or
  flags uncited prose. Anthropic's Citations API ties a cited span to its
  passage. Google's check-grounding API grades claims only against the facts the
  caller hands it. Links under More Information.
* The quote gate, the law gate and the self-report ceiling of ADR-0139 and its
  amendments stay as they are; they are structural and not in question.
* An open tab and a stored turn keep rendering (`docs/design/chat-wire-v2.md`,
  „Compatibility").

## Considered Options

* **Keep grading every statement** (ADR-0139 as it stood).
* **Hand the grader everything the answer was written from**: memory, earlier
  turns, every tool result.
* **Drop the check** and show the answer's self-report alone.
* **Judge citations and uncited statements of law only**, with code settling the
  findings and deriving the level (this record).

## Decision Outcome

Chosen option: judge citations and uncited statements of law only, because
those are the two things the grader is always shown enough to decide, and the
two a reader most needs flagged. Rejected:

* Grading every statement, because the grader is not handed memory, earlier
  turns or most tool results, so a correct answer resting on them is flagged
  by construction. It would hold again only if the grader's evidence became
  everything the answer was written from.
* Handing the grader everything, because that input is unbounded: the evidence
  is already capped at `EVIDENCE_BUDGET_CHARS`, records at
  `RECORDS_BUDGET_CHARS`, and a grader prompt of over 80,000 characters came
  back unavailable on dev (ADR-0139, amendment of 2026-11-12). It holds only
  while the grader's context and timeout are what they are today.
* Dropping the check, because a citation its own passage contradicts
  („Wendeltreppen sind zulässig [1]" against „Unzulässig sind Wendeltreppen",
  ADR-0139 round 4) is invisible to the reader and the self-report does not
  see it.

**What the grader judges** (`common/claim_judge.SYSTEM_PROMPT`):

1. A statement carrying `[N]`, against passage N: `contradicted` when the
   passage states something else, `unbacked` when it says nothing about it. A
   paraphrase or conclusion the passage plainly supports is neither.
2. A statement of what a regulation requires, allows or forbids, or whether
   something complies, with no `[N]`: `unbacked` with `source: none` and the
   regulation named, unless a passage in the evidence states it.

Everything else is never a finding: what the answer says about the person, the
office or the project, memory, earlier turns, general professional knowledge,
reasoning, descriptions, next steps, questions and offers. The one exception is
a statement the evidence plainly contradicts, which is `contradicted` with the
label that contradicts it.

**What code keeps** (`claim_judge._settled`): a finding on a marker the answer
actually wrote; an uncited `unbacked` finding only when it names a regulation;
an uncited `contradicted` finding only when it names its evidence. The grader
returns no level. Code derives it (`claim_judge.level_of`): `low` with a
contradicted finding, `medium` with any other, `high` with none. Then the quote
gate, the law gate and the self-report and open-point ceiling apply, unchanged
and in the same order.

**The wire**: `confidence_check` gains `sources_checked`, the number of cited
passages the grader read (`claim_judge.cited_passages_sent`). It is an additive
key, so `answer_confidence_version` stays `2`. A judged check without it was
made under ADR-0139's rule: the chip shows its level and no findings, and the
header names none of them.

**The header** (`derivation-header.worstFinding`) names only contradicted
findings: „N Aussagen widersprechen der Quelle". „Aussagen ohne Beleg" is gone.

**The chip** (`ConfidenceChip`) says what was checked: „N zitierte Quellen
geprüft", or „Keine Quelle zitiert. Die Stufe ist die Einschätzung des
Assistenten." Its findings read „die Quelle sagt etwas anderes", „die Quelle
sagt dazu nichts" or „Rechtsaussage ohne Fundstelle".

**Langfuse**: `confidence-findings-contradicted`, `-source-silent` and
`-law-uncited` (numeric, the statements in the comment); `confidence-judged-level`
is now the level derived from the findings (`docs/observability/langfuse.md`).

### Consequences

* Good, because an answer from memory or from earlier turns no longer carries
  findings it could never avoid, so a warning in the header means a source says
  something else.
* Good, because the level follows from the findings by a rule a reader can
  state, and the chip says what was and was not checked.
* Good, because a finding on a marker the answer never wrote, or an uncited
  finding that names neither a regulation nor its evidence, is dropped by code
  rather than trusted.
* Bad, because the grader still decides what counts as a statement of law. It
  is an LLM reading, narrower than ADR-0139's, and it can miss one or flag a
  statement that is not one.
* Bad, because a wrong uncited fact about the project is flagged by nothing,
  unless the evidence the grader was shown plainly contradicts it.
* Bad, because nothing was measured. The live harness has never run for lack of
  provider credit, and the product owner decided not to measure before this
  change. The levels are as unmeasured as ADR-0139's were.
* Neutral: a turn stored under ADR-0139's rule keeps its level and loses its
  findings in the UI; its stored findings are not rewritten.

### Confirmation

* `packages/agent/tests/common/test_claim_judge.py`: the level derived from the
  findings (`test_the_level_is_high_without_findings_medium_with_any_low_with_a_contradiction`),
  the grader returning no level, an uncited statement naming no regulation as
  no finding, a memory answer keeping only its citation finding, a marker the
  answer never wrote dropped, an uncited contradiction kept only with its
  evidence, and `TestTheGraderChecksCitationsAndLawOnly` for what the prompt
  says it never checks.
* `packages/agent/tests/core/test_answer_check_pipeline.py`: `sources_checked`
  on the wire and the contradicted-findings score.
* `apps/workspace/ui/adapters/api/wire-v2.spec.ts`: the additive key read by the
  client.
* `confidence-check.spec.ts`: `sources_checked` from either spelling, and a
  check without it read as the old rule.
* `derivation-header.spec.ts` and `chat-thinking-derivation-summary.spec.tsx`:
  an unbacked finding never reaches the header, at any level; an old-rule check
  names nothing.
* `ConfidenceChip.spec.tsx`: the three finding kinds, the sources-checked line,
  the nothing-cited line, and an old-rule check showing its level without
  findings.
* Nothing checks the grading itself in CI. Whether the grader reads statements
  of law as narrowly as this record says is the golden run's or the live
  harness's to show.

## More Information

* Revisit when the grader is handed everything the answer was written from
  (memory, earlier turns, every tool result): then grading every statement is
  decidable again. Revisit too when a golden run shows the grader flagging
  statements that are not law, or missing ones that are.
* The review behind this record:
  [Harvey, how it builds reviews and verification](https://www.harvey.ai/blog/how-harvey-is-building-reviews-and-verification),
  [Anthropic, citations](https://platform.claude.com/docs/en/build-with-claude/citations),
  [Google Cloud, check grounding](https://docs.cloud.google.com/generative-ai-app-builder/docs/check-grounding).
* This record amends ADR-0139's grading and its level; ADR-0139's call, its
  input, the delimiting, the no-check-no-level rule and its amendments stand.
