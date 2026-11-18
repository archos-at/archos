from __future__ import annotations

import re
from typing import Annotated
from typing import Literal

from pydantic import BeforeValidator

from agent.common.norm_registry import FEDERAL_STATE_TOKENS
from agent.profile_names import LEGACY_PROFILE_TOKENS

from .bff_calls import _Refused

_FACT_LABELS: dict[str, dict[str, str]] = {
    "federal_state": {token: label for token, label in FEDERAL_STATE_TOKENS.items() if label},
    "building_class": {f"gk{grade}": f"GK {grade}" for grade in range(1, 6)},
    "construction_method": {
        "masonry_solid": "Mauerwerk/Massivbau",
        "reinforced_concrete": "Stahlbeton",
        "timber": "Holzbau",
        "steel": "Stahlbau",
    },
    "uses": {
        "residential": "Wohnen",
        "office": "Büro/Verwaltung",
        "retail": "Handel",
        "catering": "Gastronomie",
        "lodging": "Beherbergung",
        "assembly": "Versammlung",
        "education": "Bildung/Betreuung",
        "healthcare": "Gesundheit/Pflege",
        "production": "Produktion/Gewerbe/Lager",
        "garage": "Garage",
        "agriculture": "Landwirtschaft",
        "technical": "Technik/Sonstiges",
    },
    "work_type": {
        "new_build": "Neubau",
        "extension": "Zubau",
        "conversion": "Umbau",
        "refurbishment": "Sanierung",
        "change_of_use": "Nutzungsänderung",
        "demolition": "Abbruch",
        "external_works": "Außenanlagen",
    },
}
FACT_OF_TOKEN: dict[str, str] = {token: fact for fact, labels in _FACT_LABELS.items() for token in labels}
_FACT_LABEL: dict[str, str] = {token: label for labels in _FACT_LABELS.values() for token, label in labels.items()}
_GK_SPELLING = re.compile(r"^(?:gk|gebaeudeklasse)?[\s_]*([1-5])$")
_LEGACY_FACT_TOKENS: dict[str, str] = {
    old: new
    for fact in _FACT_LABELS
    for old, new in LEGACY_PROFILE_TOKENS.get(fact, {}).items()
    if new in FACT_OF_TOKEN
}


def fact_token(value: object) -> object:
    if isinstance(value, int) and not isinstance(value, bool):
        value = str(value)
    if not isinstance(value, str):
        return value
    folded = value.strip().lower()
    for umlaut, spelled in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        folded = folded.replace(umlaut, spelled)
    if match := _GK_SPELLING.match(folded):
        return f"gk{match.group(1)}"
    token = folded.replace(" ", "_")
    return _LEGACY_FACT_TOKENS.get(token, token)


ProjectFact = Annotated[Literal[tuple(FACT_OF_TOKEN)], BeforeValidator(fact_token)]  # type: ignore[valid-type]


def project_facts_filter(values: list[str]) -> dict[str, list[str | int]]:
    grouped: dict[str, list[str | int]] = {}
    unknown = []
    for raw in values:
        token = fact_token(raw)
        fact = FACT_OF_TOKEN.get(token) if isinstance(token, str) else None
        if fact is None:
            unknown.append(str(raw))
            continue
        value: str | int = int(token.removeprefix("gk")) if fact == "building_class" else token
        if value not in grouped.setdefault(fact, []):
            grouped[fact].append(value)
    if unknown:
        raise _Refused(
            f"Error: unknown `project_facts`: {', '.join(unknown)}. Allowed are the values of the list in the schema."
        )
    return grouped


def _facts_line(facts: dict[str, list[str | int]]) -> str:
    labels = [
        _FACT_LABEL[f"gk{value}" if fact == "building_class" else str(value)]
        for fact, values in facts.items()
        for value in values
    ]
    return (
        f"[Only projects with these key facts: {', '.join(labels)}. Projects whose key facts do not record this "
        "are missing; say so before you conclude anything from their absence.]"
    )
