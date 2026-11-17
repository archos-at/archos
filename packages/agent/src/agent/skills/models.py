from __future__ import annotations

import logging
import re
from typing import Any
from typing import Literal

import yaml
from pydantic import BaseModel

from .legacy_names import LEGACY_METADATA_KEYS
from .legacy_names import canonical_metadata_key
from .legacy_names import metadata_value

logger = logging.getLogger(__name__)

FRONTMATTER_RE = re.compile(r"^---\r?\n(.*?)\r?\n---(?:\r?\n|$)", re.DOTALL)

NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
MAX_NAME_CHARS = 64
MAX_DESCRIPTION_CHARS = 1024
MAX_COMPATIBILITY_CHARS = 500

ANSWER_CARDS_KEY = "cards"

TITLE_KEY = "title"

MAX_TITLE_CHARS = 60

HIDDEN_KEY = "hidden"

AUTO_INVOKE_KEY = "auto-invoke"

_RESERVED_KEYS = frozenset({"agents", "catalog", ANSWER_CARDS_KEY, TITLE_KEY, HIDDEN_KEY, AUTO_INVOKE_KEY})

SKILL_METADATA_KEYS = _RESERVED_KEYS | frozenset(LEGACY_METADATA_KEYS[key] for key in _RESERVED_KEYS)

_HIDDEN_TRUE = frozenset({"true", "1", "yes"})
_HIDDEN_FALSE = frozenset({"false", "0", "no"})

XML_TAG_RE = re.compile(r"<[^>]+>")


class SkillValidationError(ValueError): ...


class Skill(BaseModel):
    name: str
    description: str
    body: str
    metadata: dict[str, str] = {}
    origin: Literal["platform", "org"] = "platform"
    collection: str | None = None
    license: str | None = None
    compatibility: str | None = None
    allowed_tools: str | None = None


def _validate_name(name: Any, expected_dir_name: str | None) -> str:
    if not isinstance(name, str) or not name.strip():
        raise SkillValidationError("Skill 'name' must be a non-empty string")
    name = name.strip()
    if len(name) > MAX_NAME_CHARS:
        raise SkillValidationError(f"Skill name {name!r} exceeds {MAX_NAME_CHARS} characters: {len(name)}")
    if not NAME_RE.match(name):
        raise SkillValidationError(
            f"Skill name {name!r} must be lowercase a-z/0-9 hyphen-separated (no leading/trailing/consecutive hyphens)"
        )
    if XML_TAG_RE.search(name):
        raise SkillValidationError(f"Skill name {name!r} must not contain XML tags")
    if expected_dir_name is not None and name != expected_dir_name:
        raise SkillValidationError(f"Skill name {name!r} does not match its directory name {expected_dir_name!r}")
    return name


def _validate_description(description: Any) -> str:
    if not isinstance(description, str) or not description.strip():
        raise SkillValidationError("Skill 'description' must be a non-empty string")
    description = description.strip()
    if len(description) > MAX_DESCRIPTION_CHARS:
        raise SkillValidationError(f"Skill description exceeds {MAX_DESCRIPTION_CHARS} characters: {len(description)}")
    if XML_TAG_RE.search(description):
        raise SkillValidationError("Skill 'description' must not contain XML tags")
    return description


def _pop_allowed_tools(payload: dict[str, Any]) -> str | None:
    hyphenated = payload.pop("allowed-tools", None)
    underscored = payload.pop("allowed_tools", None)
    value = hyphenated if hyphenated is not None else underscored
    return value if isinstance(value, str) else None


def split_metadata_list(raw: str) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for part in raw.split(","):
        name = part.strip()
        if name and name not in seen:
            seen.add(name)
            out.append(name)
    return out


def _validate_answer_cards(value: str, *, strict: bool, key: str) -> str | None:
    from agent.cards.catalog import model_facing_card_types

    known = model_facing_card_types()
    names = split_metadata_list(value)
    unknown = [name for name in names if name not in known]
    if unknown and strict:
        raise SkillValidationError(
            f"Skill metadata {key} names unknown or system card type(s) {unknown}; allowed: {sorted(known)}"
        )
    if unknown:
        logger.warning(
            "Dropping unknown or system card type(s) from %s: %s (known: %s)",
            key,
            unknown,
            sorted(known),
        )
    kept = [name for name in names if name in known]
    return ",".join(kept) if kept else None


def _validate_title(value: str, *, strict: bool, key: str) -> str | None:
    title = value.strip()
    if not title:
        if strict:
            raise SkillValidationError(f"Skill metadata {key} must not be empty")
        logger.warning("Dropping empty %s", key)
        return None
    if len(title) > MAX_TITLE_CHARS:
        if strict:
            raise SkillValidationError(f"Skill metadata {key} exceeds {MAX_TITLE_CHARS} characters: {len(title)}")
        logger.warning("Dropping over-long %s (%d characters)", key, len(title))
        return None
    if XML_TAG_RE.search(title):
        if strict:
            raise SkillValidationError(f"Skill metadata {key} must not contain XML tags")
        logger.warning("Dropping %s containing XML tags", key)
        return None
    return title


def _validate_hidden(value: str, *, strict: bool, key: str) -> str | None:
    token = value.strip().lower()
    if token in _HIDDEN_TRUE:
        return "true"
    if token in _HIDDEN_FALSE or not token:
        return None
    if strict:
        raise SkillValidationError(
            f"Skill metadata {key} must be a boolean-ish value "
            f"(one of {sorted(_HIDDEN_TRUE | _HIDDEN_FALSE)}); got {value!r}"
        )
    logger.warning("Dropping unrecognised %s value %r", key, value)
    return None


def _validate_auto_invoke(value: str, *, strict: bool, key: str) -> str | None:
    token = value.strip().lower()
    if token in _HIDDEN_FALSE:
        return "false"
    if token in _HIDDEN_TRUE or not token:
        return None
    if strict:
        raise SkillValidationError(
            f"Skill metadata {key} must be a boolean-ish value "
            f"(one of {sorted(_HIDDEN_TRUE | _HIDDEN_FALSE)}); got {value!r}"
        )
    logger.warning("Dropping unrecognised %s value %r", key, value)
    return None


def _stringify_metadata_value(key: str, value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return value
    if isinstance(value, int):
        return str(value)
    raise SkillValidationError(f"Skill metadata key {key!r} must map a string to a string")


def _validate_metadata(metadata: Any, *, strict: bool = True) -> dict[str, str]:
    if metadata is None:
        return {}
    if not isinstance(metadata, dict):
        raise SkillValidationError("Skill 'metadata' must be a mapping of strings")
    validated: dict[str, str] = {}
    for key, value in metadata.items():
        if not isinstance(key, str):
            raise SkillValidationError(f"Skill metadata key {key!r} must map a string to a string")
        value = _stringify_metadata_value(key, value)
        reserved = canonical_metadata_key(key)
        if reserved == ANSWER_CARDS_KEY:
            cards = _validate_answer_cards(value, strict=strict, key=key)
            if cards is None:
                continue
            validated[key] = cards
            continue
        if reserved == TITLE_KEY:
            title = _validate_title(value, strict=strict, key=key)
            if title is None:
                continue
            validated[key] = title
            continue
        if reserved == HIDDEN_KEY:
            hidden = _validate_hidden(value, strict=strict, key=key)
            if hidden is None:
                continue
            validated[key] = hidden
            continue
        if reserved == AUTO_INVOKE_KEY:
            auto_invoke = _validate_auto_invoke(value, strict=strict, key=key)
            if auto_invoke is None:
                continue
            validated[key] = auto_invoke
            continue
        validated[key] = value
    return validated


def preferred_cards(metadata: dict[str, str]) -> tuple[str, ...]:
    from agent.cards.catalog import model_facing_card_types

    raw = metadata_value(metadata, ANSWER_CARDS_KEY)
    if not raw:
        return ()
    known = model_facing_card_types()
    return tuple(name for name in split_metadata_list(raw) if name in known)


def skill_title(skill: Skill) -> str | None:
    title = metadata_value(skill.metadata, TITLE_KEY)
    return title if title else None


def skill_hidden(metadata: dict[str, str]) -> bool:
    return (metadata_value(metadata, HIDDEN_KEY) or "").strip().lower() in _HIDDEN_TRUE


def build_skill_from_payload(
    payload: dict[str, Any],
    *,
    origin: Literal["platform", "org"] = "platform",
    collection: str | None = None,
) -> Skill:
    payload = dict(payload)
    name = _validate_name(payload.get("name"), expected_dir_name=None)
    description = _validate_description(payload.get("description"))
    metadata = _validate_metadata(payload.get("metadata"), strict=origin != "org")
    body = payload.get("body")
    if not isinstance(body, str):
        raise SkillValidationError(f"Skill {name!r} body must be a string")
    compatibility = payload.get("compatibility")
    if compatibility is not None and (
        not isinstance(compatibility, str) or len(compatibility) > MAX_COMPATIBILITY_CHARS
    ):
        raise SkillValidationError(
            f"Skill {name!r} compatibility must be a string of at most {MAX_COMPATIBILITY_CHARS} characters"
        )
    license_ = payload.get("license")
    allowed_tools = _pop_allowed_tools(payload)
    return Skill(
        name=name,
        description=description,
        body=body,
        metadata=metadata,
        origin=origin,
        collection=collection,
        license=license_ if isinstance(license_, str) else None,
        compatibility=compatibility,
        allowed_tools=allowed_tools,
    )


def parse_skill_md(
    text: str,
    expected_dir_name: str | None = None,
    *,
    origin: Literal["platform", "org"] = "platform",
    collection: str | None = None,
) -> Skill:
    match = FRONTMATTER_RE.match(text)
    if match is None:
        raise SkillValidationError("SKILL.md must start with a `---` YAML frontmatter block")
    try:
        raw = yaml.safe_load(match.group(1))
    except yaml.YAMLError as exc:
        raise SkillValidationError(f"Invalid YAML frontmatter: {exc}") from exc
    if not isinstance(raw, dict):
        raise SkillValidationError("SKILL.md frontmatter must be a YAML mapping")

    payload = dict(raw)
    name = _validate_name(payload.pop("name", None), expected_dir_name)
    description = _validate_description(payload.pop("description", None))
    metadata = _validate_metadata(payload.pop("metadata", None))
    compatibility = payload.pop("compatibility", None)
    if compatibility is not None and (
        not isinstance(compatibility, str) or len(compatibility) > MAX_COMPATIBILITY_CHARS
    ):
        raise SkillValidationError(
            f"Skill {name!r} compatibility must be a string of at most {MAX_COMPATIBILITY_CHARS} characters"
        )
    license_ = payload.pop("license", None)
    allowed_tools = _pop_allowed_tools(payload)
    body = text[match.end() :].strip()
    return Skill(
        name=name,
        description=description,
        body=body,
        metadata=metadata,
        origin=origin,
        collection=collection,
        license=license_ if isinstance(license_, str) else None,
        compatibility=compatibility,
        allowed_tools=allowed_tools,
    )
