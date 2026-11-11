"""The golden set (``--set golden --cases <file>``): a country's golden cases as the suite's questions.

A golden case is a platform record (``golden_case``, ADR-0165 amendment): the question, the site and facts it
needs, what a right answer says (expected values, the edition, the citations) and what it must not do. A
country's cases are proposed, reviewed and published through the platform door; the suite reads them from a
file in the records format, the pack an operator proposes from
(``configs/knowledge-packs/<country>-golden-cases.json``). The suite runs with no stack, so it reads no store:
the released cases reach it as a file once the door exports a release (the pack export of the country-as-data
review, 3.8). Nothing here names a country: every word the checks look for is the case's own.

:func:`score` mirrors ``apps/workspace/bff/base-knowledge/golden/score.ts``, which scores a run on the door.
``tests/fixtures/golden/scoring_parity.json`` holds both to one set of verdicts
(``tests/test_golden_eval.py`` here, ``score.spec.ts`` there): change one and the other fails until it follows.

The suite's runs carry the law of the case's site from ``fixture_law`` (the turn's knowledge context as the
production resolvers wrote it from the packs); a case whose site that fixture does not hold runs with no site.
"""

from __future__ import annotations

import json
import unicodedata
from pathlib import Path
from typing import Any

#: The suite's generic ``family_cited`` does not apply: a golden case names its own citations.
CHECKS_FAMILY = False

#: The file ``--cases`` named; ``load_questions`` reads it (the suite calls it with no argument).
CASES_FILE: Path | None = None


def normalized(text: str) -> str:
    """Lower-cased, with every run of whitespace (a non-breaking space too) as one space."""
    return " ".join(unicodedata.normalize("NFKC", text).lower().split())


def holds_phrase(text: str, phrase: str) -> bool:
    """Whether ``phrase`` stands in ``text`` as its own words: "40 m" is not found in "140 m" or "40 mm"."""
    haystack, needle = normalized(text), normalized(phrase)
    if not needle:
        return False
    at = haystack.find(needle)
    while at >= 0:
        before = haystack[at - 1] if at > 0 else " "
        end = at + len(needle)
        after = haystack[end] if end < len(haystack) else " "
        if not (needle[0].isalnum() and before.isalnum()) and not (needle[-1].isalnum() and after.isalnum()):
            return True
        at = haystack.find(needle, at + 1)
    return False


def _holds_any(text: str, phrases: list[str]) -> bool:
    return any(holds_phrase(text, phrase) for phrase in phrases)


def _source_text(source: dict[str, Any]) -> str:
    return " | ".join(str(source[key]) for key in ("name", "documentId", "url", "clause") if source.get(key))


def _check(kind: str, name: str, passed: bool, grounding: str | None = None) -> dict[str, Any]:
    return {"kind": kind, "id": name, "passed": passed, "decides": grounding != "unconfirmed"}


def _citation_resolves(citation: dict[str, Any], answer: dict[str, Any]) -> bool:
    names = [citation["designation"], *citation.get("alsoKnownAs", [])]
    cited = [source for source in answer["sources"] if _holds_any(_source_text(source), names)]
    locus = citation.get("locus")
    located = (
        locus is None
        or holds_phrase(answer["text"], locus)
        or any(holds_phrase(_source_text(source), locus) for source in cited)
    )
    return bool(cited) and located


def _violated(rule: dict[str, Any], answer: dict[str, Any]) -> bool:
    if rule["kind"] == "source":
        naming = rule.get("naming") or []
        return any(
            source.get("kind") in rule["sourceKinds"] and (not naming or _holds_any(_source_text(source), naming))
            for source in answer["sources"]
        )
    when = rule.get("whenRecords", "any")
    if when != "any" and (when == "released") != bool(answer.get("recordsReleased")):
        return False
    confidence = answer.get("confidence") or {}
    levels = rule.get("whenConfidence") or []
    if levels and confidence.get("level") not in levels:
        return False
    text = (confidence.get("reason") or "") if rule.get("in") == "confidence_reason" else answer["text"]
    return _holds_any(text, rule["anyOf"])


def score(case: dict[str, Any], answer: dict[str, Any]) -> dict[str, Any]:
    """Every check of ``case`` against ``answer`` and the scores they make; it passes when every deciding check does.

    ``answer`` is ``{text, confidence: {level, reason} | None, sources: [{name, kind, url, clause, documentId}],
    recordsReleased}``, as ``GoldenAnswer`` in ``wire/golden-case.ts``.
    """
    expected = case.get("expected") or {}
    values = [
        _check("value", value["label"], _holds_any(answer["text"], value["anyOf"]), value["grounding"])
        for value in expected.get("values") or []
    ]
    edition = expected.get("edition")
    editions = (
        [
            _check(
                "edition",
                edition["editionKey"],
                _holds_any(answer["text"], edition["anyOf"])
                or any(_holds_any(source["name"], edition["anyOf"]) for source in answer["sources"]),
                edition["grounding"],
            )
        ]
        if edition
        else []
    )
    citations = [
        _check("citation", citation["designation"], _citation_resolves(citation, answer), citation["grounding"])
        for citation in expected.get("citations") or []
    ]
    must_not = [_check("must_not", rule["id"], not _violated(rule, answer)) for rule in case.get("mustNot") or []]
    checks = [*values, *editions, *citations, *must_not]
    passed = all(check["passed"] or not check["decides"] for check in checks)
    scores: dict[str, Any] = {
        "golden-case-passed": passed,
        "golden-must-not-violations": sum(1 for check in must_not if not check["passed"]),
    }
    if values:
        scores["golden-expected-values"] = round(sum(1 for check in values if check["passed"]) / len(values), 4)
    if editions:
        scores["edition-named"] = all(check["passed"] for check in editions)
    if citations:
        scores["claim-citation-resolves"] = all(check["passed"] for check in citations)
        scores["law-cited-from-web"] = any(source.get("kind") == "web" for source in answer["sources"])
    return {
        "passed": passed,
        "failed": [f"{check['kind']}:{check['id']}" for check in checks if not check["passed"]],
        "scores": scores,
        "unconfirmed": sum(1 for check in checks if not check["decides"]),
    }


# --- The suite's side ---------------------------------------------------------


def load_cases(path: Path) -> list[dict[str, Any]]:
    """The golden cases of a file in the records format: its ``records`` of type ``golden_case``."""
    document = json.loads(path.read_text(encoding="utf-8"))
    return [row for row in document.get("records") or [] if row.get("type") == "golden_case"]


def load_questions(path: Path | None = None) -> list[dict]:
    """Each case as a suite question: its key as the id, the case itself under ``golden``, the site as ``territory``."""
    file = path or CASES_FILE
    if file is None:
        raise SystemExit("--set golden needs --cases <file>: golden cases in the records format")
    return [
        {
            "id": case["key"],
            "question": case["question"],
            "family": "golden",
            "suite": "core",
            "set": "golden",
            "territory": (case.get("context") or {}).get("territoryId"),
            "golden": case,
        }
        for case in load_cases(file)
    ]


def answer_of(run: Any, answer_text: str) -> dict[str, Any]:
    """A suite run as the scorer reads an answer: its prose and cards, its confidence, and the source lines it wrote.

    A suite run has no citation objects, so a source is a line of the answer's own source list, with the kind
    its marker names; the door's run reads the stored citations instead.
    """
    import re

    sources = []
    for line in re.findall(r"^\s*-\s*\[\d+\]\s*(.+)$", getattr(run, "answer", "") or "", re.MULTILINE):
        marker = re.match(r"\[(\w+)\]\s*(.*)", line)
        kind = {"web": "web"}.get(marker.group(1).lower(), "building_law") if marker else None
        sources.append({"name": marker.group(2) if marker else line, **({"kind": kind} if kind else {})})
    level = getattr(run, "confidence", None)
    return {
        "text": answer_text,
        "confidence": {"level": level, "reason": getattr(run, "confidence_reason", "") or ""} if level else None,
        "sources": sources,
        "recordsReleased": True,
    }


def set_checks(question: dict, run: Any, answer: str, judge: Any) -> dict[str, bool]:
    """The golden case's checks, one key per check, as the suite records its own."""
    scored = score(question["golden"], answer_of(run, answer))
    failed = set(scored["failed"])
    case = question["golden"]
    expected = case.get("expected") or {}
    names = [
        *(f"value:{value['label']}" for value in expected.get("values") or []),
        *([f"edition:{expected['edition']['editionKey']}"] if expected.get("edition") else []),
        *(f"citation:{citation['designation']}" for citation in expected.get("citations") or []),
        *(f"must_not:{rule['id']}" for rule in case.get("mustNot") or []),
    ]
    return {name: name not in failed for name in names}
