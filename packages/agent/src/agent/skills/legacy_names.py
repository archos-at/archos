from __future__ import annotations

from collections.abc import Mapping

from .legacy_brand_names import LEGACY_METADATA_KEYS
from .legacy_brand_names import LEGACY_PLATFORM_SKILL_NAMES

LEGACY_SKILL_NAMES: dict[str, str] = {
    "einreichcheck": "submission-check",
    "brandschutz": "fire-safety",
    "bestand": "existing-building",
    "nutzungssicherheit": "safety-in-use",
    "gebaeudeklasse": "building-class",
    "waermeschutz": "thermal-protection",
    "bebauung": "plot-development",
    "pruefbericht-writer": "inspection-report-writer",
}

_CURRENT_SKILL_NAME: dict[str, str] = {**LEGACY_SKILL_NAMES, **LEGACY_PLATFORM_SKILL_NAMES}
_CURRENT_METADATA_KEY: dict[str, str] = {stored: current for current, stored in LEGACY_METADATA_KEYS.items()}


def canonical_skill_name(name: str) -> str:
    return _CURRENT_SKILL_NAME.get(name, name)


def skill_name_family(name: str) -> tuple[str, ...]:
    current = canonical_skill_name(name)
    return (current, *(legacy for legacy, now in _CURRENT_SKILL_NAME.items() if now == current))


def canonical_metadata_key(key: str) -> str:
    return _CURRENT_METADATA_KEY.get(key, key)


def find_skill[T](by_name: Mapping[str, T], name: str) -> T | None:
    if name in by_name:
        return by_name[name]
    wanted = canonical_skill_name(name)
    return next((skill for stored, skill in by_name.items() if canonical_skill_name(stored) == wanted), None)


def metadata_value(metadata: Mapping[str, str], key: str) -> str | None:
    if key in metadata:
        return metadata[key]
    return metadata.get(LEGACY_METADATA_KEYS[key])
