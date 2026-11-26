from __future__ import annotations

import json
import re
from collections.abc import Iterable
from collections.abc import Sequence

from scripts.loop_eval_rows import Observation
from scripts.loop_eval_rows import Question
from scripts.loop_eval_rows import family_coverage

_CLAUSE_NUMBER_RE = re.compile(r"\b(?:Pkt\.?|Punkt)\s*(\d+(?:\.\d+)*)")


_ROUND_STEP_RE = re.compile(r"^status:retrieval:(\d+)$")


_CHECKPOINT_STEP_RE = re.compile(r"^status:checkpoint:(\d+)$")


_COVERAGE_STEP_RE = re.compile(r"^status:coverage:(.+)$")


_BUDGET_STEP = "status:budget"


def _yes_no(value: bool) -> str:
    return "yes" if value else "no"


def _status_payloads(steps: Iterable[dict]) -> list[tuple[str, dict]]:
    out: list[tuple[str, dict]] = []
    for step in steps:
        name = str(step.get("name") or step.get("functionName") or "")
        body = _decoded_payload(step.get("payload"))
        if name and isinstance(body, dict):
            out.append((name, body))
    return out


def _decoded_payload(body: object) -> object:
    if isinstance(body, str):
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            return None
    return body


def cited_clauses(answer: str) -> list[str]:
    return [match.group(1) for match in _CLAUSE_NUMBER_RE.finditer(answer or "")]


def clause_matches(expected: str | None, cited: Sequence[str]) -> str:
    if not expected:
        return ""
    for number in cited:
        if number == expected or number.startswith(f"{expected}."):
            return "yes"
    return "no"


def _normalise_query(text: object) -> str:
    try:
        return re.sub(r"\s+", " ", str(text or "")).strip().casefold()
    except Exception:
        return ""


_LOCATOR_ELIGIBLE_RE = re.compile(
    r"oib[-\s_]*rl|richtlinie\s*\d|\brl\s*\d|\bpkt\.?\b|\bpunkt\b|§|\bseite\b|\bpage\b|\btabelle\b|\.pdf\b|oib-rl_|oib-richtlinie_",
    re.IGNORECASE,
)


_CAP_STEP_NAMES = frozenset({"status:budget", "status:budget:input"})


_WIDTH_CAP_STEP_PREFIX = "status:width:"


_REPAIR_STEP_NAME = "status:repair"


def _retrieval_queries(payloads: Sequence[tuple[str, dict]]) -> list[str]:
    queries: list[str] = []
    for name, body in payloads:
        if _ROUND_STEP_RE.match(name):
            normalised = _round_query(body)
        elif name.startswith("retrieve."):
            normalised = _retrieve_query(body)
        else:
            normalised = ""
        if normalised:
            queries.append(normalised)
    return queries


def _round_query(body: dict) -> str:
    values = body.get("values") or {}
    query = values.get("query") or body.get("query")
    return _normalise_query(query)


def _retrieve_query(body: dict) -> str:
    raw = body.get("input") or body.get("output") or body
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            raw = {}
    if not isinstance(raw, dict):
        return ""
    for key in ("normalized_query", "query", "retrieval_query"):
        normalised = _normalise_query(raw.get(key))
        if normalised:
            return normalised
    return ""


def flag_repeat_query(payloads: Sequence[tuple[str, dict]]) -> str:
    seen: set[str] = set()
    for query in _retrieval_queries(payloads):
        if query in seen:
            return "yes"
        seen.add(query)
    return "no"


def flag_locator_eligible(question: Question, payloads: Sequence[tuple[str, dict]], tools: Sequence[str]) -> str:
    if "read_passage" in list(tools or []):
        return "no"
    candidates = [question.question, *(_retrieval_queries(payloads))]
    if any(isinstance(text, str) and _LOCATOR_ELIGIBLE_RE.search(text) for text in candidates if text):
        return "yes"
    return "no"


def _as_payload_dict(value: object) -> dict:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return {}
    return value if isinstance(value, dict) else {}


def flag_cap_retry(payloads: Sequence[tuple[str, dict]]) -> str:
    capped_at: int | None = None
    for index, (name, body) in enumerate(payloads):
        capped = name in _CAP_STEP_NAMES or name.startswith(_WIDTH_CAP_STEP_PREFIX)
        if capped or (name.startswith("retrieve.") and _dropped_by_cap(body)):
            capped_at = index
            continue
        if capped_at is not None and (name.startswith("retrieve.") or _ROUND_STEP_RE.match(name)):
            return "yes"
    return "no"


def _dropped_by_cap(body: dict) -> bool:
    raw = _as_payload_dict(body.get("input"))
    return bool(raw.get("dropped_by_cap") or 0)


def flag_repair_fetch(payloads: Sequence[tuple[str, dict]]) -> str:
    return "yes" if any(name == _REPAIR_STEP_NAME for name, _ in payloads) else "no"


def _citation_keys_by_round(payloads: Sequence[tuple[str, dict]]) -> dict[int | None, set[str]]:
    by_round: dict[int | None, set[str]] = {}
    for name, body in payloads:
        if not name.startswith("retrieve."):
            continue
        out = _as_payload_dict(body.get("output"))
        inp = _as_payload_dict(body.get("input"))
        keys = out.get("citation_keys") or out.get("picked") or []
        if isinstance(keys, list) and keys and isinstance(keys[0], dict):
            keys = [str(item.get("citation_key") or item.get("file") or "") for item in keys]
        keys = {str(key).strip().casefold() for key in keys if str(key).strip()}
        if not keys:
            continue
        try:
            round_index: int | None = int(inp.get("round")) if inp.get("round") is not None else None
        except TypeError, ValueError:
            round_index = None
        by_round.setdefault(round_index, set()).update(keys)
    return by_round


def flag_cross_turn(payloads: Sequence[tuple[str, dict]]) -> str:
    by_round = _citation_keys_by_round(payloads)
    if len(by_round) < 2:
        return "no"
    seen: set[str] = set()
    for keys in by_round.values():
        if seen & keys:
            return "yes"
        seen.update(keys)
    return "no"


_RIS_TOOL_PREFIXES = ("ris", "law_lookup")


_PARAGRAPH_RE = re.compile(
    r"(§|Art(?:ikel)?\.?)\s*(\d+)([a-z](?![a-z]))?(?:\s*Abs\.?\s*(\d+[a-z]?))?",
    re.IGNORECASE,
)


def count_ris_calls(tools: Sequence[str]) -> int:
    return sum(1 for tool in tools if str(tool).lower().startswith(_RIS_TOOL_PREFIXES))


def _paragraph_keys(text: object) -> list[str]:
    keys = []
    for match in _PARAGRAPH_RE.finditer(str(text or "")):
        kind = "art" if match.group(1).lower().startswith("art") else "§"
        suffix = (match.group(3) or "").lower()
        absatz = f"abs{match.group(4).lower()}" if match.group(4) else ""
        keys.append(f"{kind}{match.group(2)}{suffix}{absatz}")
    return keys


def _same_paragraph(cited: str, expected: str) -> bool:
    return cited.startswith(expected) or expected.startswith(cited)


def _retrieved_paragraphs(payloads: Sequence[tuple[str, dict]]) -> set[str]:
    found: set[str] = set()
    for name, body in payloads:
        if not name.startswith(tuple(f"retrieve.{p}" for p in _RIS_TOOL_PREFIXES)):
            continue
        out = _as_payload_dict(body.get("output"))
        for value in out.get("clause_ids") or out.get("punkt_ids") or []:
            found.update(_paragraph_keys(value))
    return found


def paragraph_matches(question: Question, answer: str, payloads: Sequence[tuple[str, dict]]) -> str:
    expected = set(_paragraph_keys(question.paragraph)) or _retrieved_paragraphs(payloads)
    if not expected:
        return ""
    cited = set(_paragraph_keys(answer))
    if not cited:
        return "no"
    return _yes_no(any(_same_paragraph(one, other) for one in cited for other in expected))


def flag_ris_citation_resolved(answer: str, payloads: Sequence[tuple[str, dict]]) -> str:
    keys = [
        str(key).strip()
        for name, body in payloads
        if name.startswith(tuple(f"retrieve.{p}" for p in _RIS_TOOL_PREFIXES))
        for key in (_as_payload_dict(body.get("output")).get("citation_keys") or [])
        if str(key).strip()
    ]
    if not keys:
        return ""
    lowered = (answer or "").casefold()
    return _yes_no(any(key.casefold() in lowered for key in keys))


def _expected_family_number(family: str | None) -> str | None:
    if not family:
        return None
    match = re.search(r"OIB-RL\s*(\d+)", str(family), re.IGNORECASE)
    return match.group(1) if match else None


def flag_family_overlap(expected_family: str | None, family_cell: str) -> str:
    touched = [family for family, _o, _l in family_coverage(family_cell)]
    if len(touched) > 1:
        return "yes"
    expected = _expected_family_number(expected_family)
    if expected and touched and expected not in touched:
        return "yes"
    return "no"


def _stated_round(body: dict) -> int | None:
    raw = body.get("input") or {}
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            return None
    if not isinstance(raw, dict) or raw.get("round") is None:
        return None
    try:
        return int(raw["round"])
    except TypeError, ValueError:
        return None


def observe(question: Question, steps: Sequence[dict], answer: str, envelope: dict | None) -> Observation:
    payloads = _status_payloads(steps)
    rounds = {int(m.group(1)) for name, _ in payloads if (m := _ROUND_STEP_RE.match(name))}
    for name, body in payloads:
        if name.startswith("retrieve.") and (stated := _stated_round(body)) is not None:
            rounds.add(stated)
    checkpoints = {
        int(m.group(1)): str(body.get("source") or "none")
        for name, body in payloads
        if (m := _CHECKPOINT_STEP_RE.match(name))
    }
    tools = [tool for _, body in payloads for tool in (body.get("tools") or [])]
    coverage = {
        str(body.get("family") or m.group(1)): (int(body.get("opened") or 0), int(body.get("listed") or 0))
        for name, body in payloads
        if (m := _COVERAGE_STEP_RE.match(name))
    }
    truncated = any(name == _BUDGET_STEP and body.get("truncated") for name, body in payloads)
    envelope = envelope or {}
    family_cell = " ".join(f"{family} {opened}/{listed}" for family, (opened, listed) in sorted(coverage.items()))
    return Observation(
        id=question.id,
        expected_family=question.family or "",
        expected_clause=question.clause or "",
        expected_kind=question.kind,
        kind=str(envelope.get("kind") or ""),
        verdict=_yes_no(bool(envelope.get("verdict"))),
        rounds=str(len(rounds)),
        read_passage=_yes_no("read_passage" in tools),
        clause_match=clause_matches(question.clause, cited_clauses(answer)),
        truncated=_yes_no(truncated),
        checkpoint_sources=">".join(checkpoints[index] for index in sorted(checkpoints)),
        family_coverage=family_cell,
        repeat_query=flag_repeat_query(payloads),
        locator_eligible=flag_locator_eligible(question, payloads, tools),
        cap_retry=flag_cap_retry(payloads),
        repair_fetch=flag_repair_fetch(payloads),
        cross_turn=flag_cross_turn(payloads),
        family_overlap=flag_family_overlap(question.family, family_cell),
        ris_calls=str(count_ris_calls(tools)),
        paragraph_match=paragraph_matches(question, answer, payloads),
        ris_citation_resolved=flag_ris_citation_resolved(answer, payloads),
    )
