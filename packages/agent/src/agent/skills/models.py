"""Skill model and STRICT SKILL.md parsing for the skills substrate.

The agentskills.io format contract:
- ``name``: 1-64 chars, lowercase a-z/0-9/hyphens, no leading/trailing/
  consecutive hyphens; for filesystem skills it must match the parent dir name.
- ``description``: 1-1024 chars, non-empty.
- ``license``: optional free-form string.
- ``compatibility``: optional, at most 500 chars.
- ``metadata``: map of strings; reserved keys are validated
  (``grid-cards`` must name known, non-system card types; ``grid-title``
  is a short human display name).
- ``allowed-tools``: optional free-form string (tool-level allowlist).
- Body: markdown; <500 lines recommended, not enforced.

Unlike deepagents' warn-and-continue scan, this substrate validates
strictly: an invalid SKILL.md is an error, never a silent skip.
"""

from __future__ import annotations

import logging
import re
from typing import Any
from typing import Literal

import yaml
from pydantic import BaseModel

logger = logging.getLogger(__name__)

FRONTMATTER_RE = re.compile(r"^---\r?\n(.*?)\r?\n---(?:\r?\n|$)", re.DOTALL)

NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
MAX_NAME_CHARS = 64
MAX_DESCRIPTION_CHARS = 1024
MAX_COMPATIBILITY_CHARS = 500

SKILL_METADATA_KEYS = frozenset(
    {"grid-agents", "grid-cards", "grid-title", "grid-hidden", "grid-auto-invoke", "grid-catalog"}
)

ANSWER_CARDS_KEY = "grid-cards"

TITLE_KEY = "grid-title"

MAX_TITLE_CHARS = 60

HIDDEN_KEY = "grid-hidden"

AUTO_INVOKE_KEY = "grid-auto-invoke"

_HIDDEN_TRUE = frozenset({"true", "1", "yes"})
_HIDDEN_FALSE = frozenset({"false", "0", "no"})

XML_TAG_RE = re.compile(r"<[^>]+>")


class SkillValidationError(ValueError):
    """A SKILL.md (or BFF skill payload) violates the agentskills.io contract."""


class Skill(BaseModel):
    """A validated skill in the skills substrate.

    Attributes:
        name: Lowercase hyphenated skill id (1-64 chars).
        description: One-line summary shown to the model (progressive
            disclosure level 1).
        body: The full markdown instructions (level 2, loaded via
            ``read_file`` on its ``SKILL.md``).
        metadata: Reserved keys + free-form extra keys.
        origin: ``platform`` for builtin files, ``org`` for BFF-served rows.
        collection: Mid-level collection dir name for builtin files
            (bim|oib|research|synthesis); ``None`` for org rows.
        license: Optional license string.
        compatibility: Optional compatibility note (<=500 chars).
        allowed_tools: Optional tool allowlist string.
    """

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
    """Read the tool allowlist under either spelling.

    SKILL.md frontmatter spells it ``allowed-tools`` (the Agent Skills spec);
    the BFF row and this module's own field spell it ``allowed_tools``. Reading
    only the underscore form meant a hand-written SKILL.md declaring
    ``allowed-tools`` had its allowlist silently dropped — a permission
    narrowing that vanishes is worse than one that errors, so both spellings
    are accepted and the hyphenated one wins where a file sets both.
    """
    hyphenated = payload.pop("allowed-tools", None)
    underscored = payload.pop("allowed_tools", None)
    value = hyphenated if hyphenated is not None else underscored
    return value if isinstance(value, str) else None


def split_metadata_list(raw: str) -> list[str]:
    """Split a reserved comma-list value: trimmed, empties dropped, order kept.

    Deduplicated because these lists are read as sets of preferences, and a name
    repeated in the frontmatter should not be repeated back at the model.
    """
    seen: set[str] = set()
    out: list[str] = []
    for part in raw.split(","):
        name = part.strip()
        if name and name not in seen:
            seen.add(name)
            out.append(name)
    return out


def _validate_answer_cards(value: str, *, strict: bool) -> str | None:
    """Validate ``grid-cards`` against the model-facing card catalog.

    Returns the value to store, or ``None`` when nothing usable is left and the
    key should be dropped entirely.

    Two tolerances, matching how the two sources of skills fail. A SKILL.md is
    authored in this repo and reviewed, so a name that no longer exists is a
    typo we want to hear about at parse time (``strict``). A BFF-served org row
    is tenant data arriving over the wire, where one stale name must not delete
    the whole skill from the toolbox — so the bad entries are logged and dropped
    and the rest of the row survives, exactly as the resolver treats an unknown
    ``grid-agents`` name.

    A SYSTEM card is rejected on both paths and never merely downgraded: it is
    emitted by a tool on a sanctioned path, and telling the model to produce one
    would be inviting it to fabricate a card the product treats as trustworthy.
    """
    from agent.cards.catalog import model_facing_card_types

    known = model_facing_card_types()
    names = split_metadata_list(value)
    unknown = [name for name in names if name not in known]
    if unknown and strict:
        raise SkillValidationError(
            f"Skill metadata {ANSWER_CARDS_KEY} names unknown or system card type(s) {unknown}; "
            f"allowed: {sorted(known)}"
        )
    if unknown:
        logger.warning(
            "Dropping unknown or system card type(s) from %s: %s (known: %s)",
            ANSWER_CARDS_KEY,
            unknown,
            sorted(known),
        )
    kept = [name for name in names if name in known]
    return ",".join(kept) if kept else None


def _validate_title(value: str, *, strict: bool) -> str | None:
    """Validate ``grid-title``; return the value to store, or ``None`` to drop it.

    Same two tolerances as :func:`_validate_answer_cards`, for the same reason: a
    SKILL.md is reviewed in this repo, so a title that is empty, over-long or
    carries markup is an authoring error we want at parse time; a BFF-served
    org row is tenant data over the wire, where a bad title must cost the
    tenant its title and not its whole skill.

    Tags are rejected on both paths because a title is interpolated into the
    same prompt-adjacent and user-facing surfaces ``name`` is — see
    :data:`XML_TAG_RE`.
    """
    title = value.strip()
    if not title:
        if strict:
            raise SkillValidationError(f"Skill metadata {TITLE_KEY} must not be empty")
        logger.warning("Dropping empty %s", TITLE_KEY)
        return None
    if len(title) > MAX_TITLE_CHARS:
        if strict:
            raise SkillValidationError(f"Skill metadata {TITLE_KEY} exceeds {MAX_TITLE_CHARS} characters: {len(title)}")
        logger.warning("Dropping over-long %s (%d characters)", TITLE_KEY, len(title))
        return None
    if XML_TAG_RE.search(title):
        if strict:
            raise SkillValidationError(f"Skill metadata {TITLE_KEY} must not contain XML tags")
        logger.warning("Dropping %s containing XML tags", TITLE_KEY)
        return None
    return title


def _validate_hidden(value: str, *, strict: bool) -> str | None:
    """Validate ``grid-hidden``; return canonical ``"true"`` to store, or ``None`` to drop.

    Same two tolerances as :func:`_validate_title`, for the same reason: a
    SKILL.md is reviewed in this repo, so ``grid-hidden: maybe`` is an authoring
    typo we want at parse time (``strict``); a BFF-served org row is tenant data
    over the wire, where a garbage flag must cost the tenant the flag and not
    the whole skill (``lenient``).

    A truthy token normalises to the canonical ``"true"``. The recognised falsy
    tokens and an empty string drop the key entirely, because visible is the
    default and an absent key already reads as visible — storing ``"false"``
    would be a second spelling of "nothing" for every reader to special-case.
    A bad flag costs the flag, never the skill or the turn.
    """
    token = value.strip().lower()
    if token in _HIDDEN_TRUE:
        return "true"
    if token in _HIDDEN_FALSE or not token:
        return None
    if strict:
        raise SkillValidationError(
            f"Skill metadata {HIDDEN_KEY} must be a boolean-ish value "
            f"(one of {sorted(_HIDDEN_TRUE | _HIDDEN_FALSE)}); got {value!r}"
        )
    logger.warning("Dropping unrecognised %s value %r", HIDDEN_KEY, value)
    return None


def _validate_auto_invoke(value: str, *, strict: bool) -> str | None:
    """Validate ``grid-auto-invoke``; return canonical ``"false"`` or ``None``.

    Kept only so an old document still parses (see
    :data:`AUTO_INVOKE_KEY`). A truthy token and an empty string drop the
    key; a recognised falsy token is normalised to ``"false"`` and stored. No
    reader acts on either.

    Same two tolerances as :func:`_validate_hidden`. A garbage flag on a
    reviewed SKILL.md is an authoring error; on an org row it costs the flag
    (and so reads as on) rather than the skill.
    """
    token = value.strip().lower()
    if token in _HIDDEN_FALSE:
        return "false"
    if token in _HIDDEN_TRUE or not token:
        return None
    if strict:
        raise SkillValidationError(
            f"Skill metadata {AUTO_INVOKE_KEY} must be a boolean-ish value "
            f"(one of {sorted(_HIDDEN_TRUE | _HIDDEN_FALSE)}); got {value!r}"
        )
    logger.warning("Dropping unrecognised %s value %r", AUTO_INVOKE_KEY, value)
    return None


def _stringify_metadata_value(key: str, value: Any) -> str:
    """Metadata is strings. YAML and JSON both have native booleans.

    An unquoted ``grid-hidden: true`` is a YAML bool. Rejecting it used to take
    down every builtin when one file used that spelling. Coerce, then validate.
    Integers follow for the same reason (``grid-hidden: 1``). Nested types stay
    an error — those are not a spelling of a flag.
    """
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
        if key == ANSWER_CARDS_KEY:
            cards = _validate_answer_cards(value, strict=strict)
            if cards is None:
                continue
            validated[key] = cards
            continue
        if key == TITLE_KEY:
            title = _validate_title(value, strict=strict)
            if title is None:
                continue
            validated[key] = title
            continue
        if key == HIDDEN_KEY:
            hidden = _validate_hidden(value, strict=strict)
            if hidden is None:
                continue
            validated[key] = hidden
            continue
        if key == AUTO_INVOKE_KEY:
            auto_invoke = _validate_auto_invoke(value, strict=strict)
            if auto_invoke is None:
                continue
            validated[key] = auto_invoke
            continue
        validated[key] = value
    return validated


def preferred_cards(metadata: dict[str, str]) -> tuple[str, ...]:
    """The card types a skill prefers, in author order; ``()`` when unset.

    Filtered against the catalog on read as well as on write: a skill snapshot
    persisted before a card type was retired would otherwise name a card the
    renderer no longer has.
    """
    from agent.cards.catalog import model_facing_card_types

    raw = metadata.get(ANSWER_CARDS_KEY)
    if not raw:
        return ()
    known = model_facing_card_types()
    return tuple(name for name in split_metadata_list(raw) if name in known)


def skill_title(skill: Skill) -> str | None:
    """The skill's human display name, or ``None`` when the author gave none.

    ``None`` is a real answer, not a failure: see :data:`TITLE_KEY` for
    why no title is ever synthesised from the id here.
    """
    title = skill.metadata.get(TITLE_KEY)
    return title if title else None


def skill_hidden(metadata: dict[str, str]) -> bool:
    """Whether this skill's live activation line is suppressed by default.

    ``True`` routes the activation to the technical channel instead of the live
    one (see :mod:`agent.skills.events`), keeping it out of the noisy live
    line while the event still fires and still records. Hidden is never
    concealed: the disclosure still names the skill and a reader who turns on
    the "reasoning" preference surfaces it — see :data:`HIDDEN_KEY`.

    Read as tolerantly as it is written: the value stored is the canonical
    ``"true"``, but an un-revalidated snapshot may carry any truthy token, so an
    absent or unrecognised value reads as visible — the fail-open default.
    """
    return metadata.get(HIDDEN_KEY, "").strip().lower() in _HIDDEN_TRUE


def build_skill_from_payload(
    payload: dict[str, Any],
    *,
    origin: Literal["platform", "org"] = "platform",
    collection: str | None = None,
) -> Skill:
    """Build + validate a :class:`Skill` from parsed data (YAML frontmatter or BFF row).

    Raises :class:`SkillValidationError` on any contract violation — the shared
    strict path for both builtin files and org rows.

    The one deliberate softening is ``origin="org"``: a tenant row's reserved
    comma-lists are validated leniently (unknown entries logged and dropped)
    rather than taking the whole skill down. Everything structural still errors.
    """
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
    """Parse a SKILL.md document into a validated :class:`Skill`.

    HARD-fails (raises :class:`SkillValidationError`) on malformed frontmatter,
    invalid YAML, or any field violating the agentskills.io contract — the
    substrate validates strictly, unlike deepagents' warn-and-continue scan.
    """
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
