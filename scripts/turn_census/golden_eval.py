from __future__ import annotations

import json
import unicodedata
from pathlib import Path
from typing import Any

CHECKS_FAMILY = False

CASES_FILE: Path | None = None


def normalized(text: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", text).lower().split())


def holds_phrase(text: str, phrase: str) -> bool:
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
    unverified = not any(check["decides"] for check in checks)
    passed = not unverified and all(check["passed"] or not check["decides"] for check in checks)
    scores: dict[str, Any] = {
        "golden-case-passed": passed,
        "golden-must-not-violations": sum(1 for check in must_not if not check["passed"]),
    }
    if values:
        scores["golden-expected-values"] = round(sum(1 for check in values if check["passed"]) / len(values), 4)
    if citations:
        scores["claim-citation-resolves"] = all(check["passed"] for check in citations)
    return {
        "passed": passed,
        "failed": [f"{check['kind']}:{check['id']}" for check in checks if not check["passed"]],
        "scores": scores,
        "unconfirmed": sum(1 for check in checks if not check["decides"]),
        "unverified": unverified,
    }


def load_cases(path: Path) -> list[dict[str, Any]]:
    document = json.loads(path.read_text(encoding="utf-8"))
    return [row for row in document.get("records") or [] if row.get("type") == "golden_case"]


def load_questions(path: Path | None = None) -> list[dict]:
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
