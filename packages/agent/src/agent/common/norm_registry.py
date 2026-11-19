from __future__ import annotations

import logging
import os
import re
from collections.abc import Callable
from collections.abc import Iterable
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

import yaml
from pydantic import AliasChoices
from pydantic import BaseModel
from pydantic import Field
from pydantic import ValidationError
from pydantic import field_validator

from agent.common.family_query import family_query_number  # noqa: F401  (re-exported)
from agent.common.legacy_lane_names import LEGACY_AGENT_AUTHORED_LANE
from agent.common.oib_file_names import canonical_oib_file_name
from agent.common.source_kinds import AGENT_AUTHORED_LANE
from agent.common.source_kinds import AGENT_AUTHORED_LANE_LABEL
from agent.common.source_kinds import MAIL_LANE
from agent.common.source_kinds import MAIL_LANE_LABEL
from agent.common.source_kinds import MAIL_SOURCE_FORMAT
from agent.common.source_kinds import OFFICE_MAIL_LANE
from agent.profile_names import normalize_profile_token

logger = logging.getLogger(__name__)

DEFAULT_NORMS_DIR = "configs/norms"
ENV_NORMS_DIR = "NORMS_DIR"

KNOWN_APPLICATIONS = frozenset(
    {
        "BrKons",
        "LrKons",
        "BgblAuth",
        "LgblAuth",
        "Begut",
        "RegV",
        "Vfgh",
        "Vwgh",
        "Justiz",
        "Bvwg",
        "Lvwg",
        "Dsk",
        "Erlaesse",
        "Vbl",
        "Lgbl",
    }
)

NormRank = Literal["federal_law", "state_law", "ordinance", "authority_info", "external_standard"]

LEGACY_NORM_RANK: dict[str, str] = {
    "bundesgesetz": "federal_law",
    "landesgesetz": "state_law",
    "verordnung": "ordinance",
    "behoerdliche_info": "authority_info",
    "norm_extern": "external_standard",
}

BUNDESLAENDER: tuple[str, ...] = (
    "Wien",
    "Niederösterreich",
    "Oberösterreich",
    "Steiermark",
    "Kärnten",
    "Salzburg",
    "Tirol",
    "Vorarlberg",
    "Burgenland",
)

FEDERAL_STATE_TOKENS: dict[str, str | None] = {
    "vienna": "Wien",
    "lower_austria": "Niederösterreich",
    "upper_austria": "Oberösterreich",
    "styria": "Steiermark",
    "carinthia": "Kärnten",
    "salzburg": "Salzburg",
    "tyrol": "Tirol",
    "vorarlberg": "Vorarlberg",
    "burgenland": "Burgenland",
    "outside_austria": None,
}

_STRUCTURED_FEDERAL_STATE_RE = re.compile(r"\b(?:federal_state|bundesland)=([a-z_]+)")

_MIN_TOPIC_LENGTH = 4


class VerifySeed(BaseModel):
    title_query: str
    expect: str = ""
    exclude: list[str] = Field(default_factory=list)
    statute_number: str = Field(default="", validation_alias=AliasChoices("statute_number", "gesetzesnummer"))


class NormEntry(BaseModel):
    id: str
    title: str
    short: str
    rank: NormRank = "state_law"

    @field_validator("rank", mode="before")
    @classmethod
    def _legacy_rank(cls, value: object) -> object:
        return LEGACY_NORM_RANK.get(value, value) if isinstance(value, str) else value

    federal_state: str = Field(default="", validation_alias=AliasChoices("federal_state", "bundesland"))
    topics: list[str] = Field(default_factory=list)
    relevance: str = ""
    application: str = ""  # OGD-RIS application; empty for non-RIS entries
    document_number: str = ""
    citation_url: str = ""
    full_law_url: str = ""
    source_url: str = ""  # direct link for non-RIS sources (wien.gv.at, oib.or.at, …)
    aliases: list[str] = Field(default_factory=list)
    binding_note: str = ""  # prose legal fact, rendered into the prompt block
    review_note: str = ""  # open verification TODO (admin UI only, never prompt fact)
    verify: VerifySeed | None = None
    verified_at: str = ""

    @property
    def is_ris(self) -> bool:
        return bool(self.application and self.document_number)


class NormsFile(BaseModel):
    version: int = 1
    corpus_collection: str = "oib_knowledge"
    language: str = ""
    states: dict[str, str | None] = Field(default_factory=dict)

    @field_validator("states", mode="before")
    @classmethod
    def _legacy_state_tokens(cls, value: object) -> object:
        if not isinstance(value, dict):
            return value
        return {normalize_profile_token("federal_state", str(token)): name for token, name in value.items()}

    corpus_note: str = ""
    doctrine: str = ""
    parcel_tags: list[str] = Field(default_factory=list)
    entries: list[NormEntry] = Field(default_factory=list)


class NormRegistry(BaseModel):
    entries: list[NormEntry] = Field(default_factory=list)

    def by_id(self, entry_id: str) -> NormEntry | None:
        for entry in self.entries:
            if entry.id == entry_id:
                return entry
        return None


def _normalize(text: str) -> str:
    return text.strip().lower().replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")


_db_loader: Callable[[], NormsFile | None] | None = None
_db_cache_reset: Callable[[], None] | None = None


def set_db_loader(
    loader: Callable[[], NormsFile | None] | None,
    cache_reset: Callable[[], None] | None = None,
) -> None:
    global _db_loader, _db_cache_reset
    _db_loader = loader
    _db_cache_reset = cache_reset
    reset_registry_cache()


_REPO_ROOT = Path(__file__).resolve().parents[5]


def _norms_dir(path: str | None) -> Path:
    if path:
        return Path(path)
    env_value = os.environ.get(ENV_NORMS_DIR)
    if env_value:
        return Path(env_value)
    default = Path(DEFAULT_NORMS_DIR)
    if default.is_dir():
        return default
    from_root = _REPO_ROOT / DEFAULT_NORMS_DIR
    return from_root if from_root.is_dir() else default


def _validated_entries(norms_file: NormsFile, origin: str) -> list[NormEntry]:
    kept: list[NormEntry] = []
    seen: set[str] = set()
    for entry in norms_file.entries:
        if entry.id in seen:
            logger.warning("norm_registry: duplicate entry id '%s' in %s — later copy dropped", entry.id, origin)
            continue
        if entry.application and entry.application not in KNOWN_APPLICATIONS:
            logger.warning(
                "norm_registry: entry '%s' has unknown RIS application '%s' — entry dropped",
                entry.id,
                entry.application,
            )
            continue
        if entry.rank in ("federal_law", "state_law", "ordinance") and not entry.is_ris:
            logger.warning(
                "norm_registry: law entry '%s' (rank %s) has no RIS pointer — entry dropped",
                entry.id,
                entry.rank,
            )
            continue
        if entry.federal_state and entry.federal_state not in BUNDESLAENDER:
            logger.warning(
                "norm_registry: entry '%s' has unknown Bundesland '%s' — entry dropped",
                entry.id,
                entry.federal_state,
            )
            continue
        seen.add(entry.id)
        kept.append(entry)
    return kept


@lru_cache(maxsize=8)
def _load_yaml_cached(resolved: str, mtime_ns: int) -> NormsFile | None:
    del mtime_ns
    path = Path(resolved)
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError:
        logger.warning("norm_registry: registry file not readable at %s — registry disabled", path)
        return None
    try:
        data = yaml.safe_load(raw)
        return NormsFile.model_validate(data)
    except (yaml.YAMLError, ValidationError) as exc:
        logger.warning("norm_registry: invalid registry at %s (%s) — registry disabled", path, exc)
        return None


def registry_yaml_files(norms_dir: str | None = None) -> list[Path]:
    root = _norms_dir(norms_dir)
    return sorted(root.glob("*/registry.yml")) if root.is_dir() else []


def load_registry(norms_dir: str | None = None) -> NormRegistry | None:
    if norms_dir is None and _db_loader is not None:
        try:
            stored = _db_loader()
        except Exception:  # noqa: BLE001 — the hot path must never break on store errors
            logger.warning("norm_registry: admin-store loader failed — falling back to YAML seed", exc_info=True)
            stored = None
        if stored is not None and stored.entries:
            entries = _validated_entries(stored, "admin store")
            return NormRegistry(entries=entries) if entries else None
    files = registry_yaml_files(norms_dir)
    if not files:
        logger.warning("norm_registry: no registry files under %s — registry disabled", _norms_dir(norms_dir))
        return None
    merged: list[NormEntry] = []
    for file_path in files:
        try:
            mtime = file_path.stat().st_mtime_ns
        except OSError:
            mtime = -1
        norms_file = _load_yaml_cached(str(file_path), mtime)
        if norms_file is not None:
            merged.extend(_validated_entries(norms_file, str(file_path)))
    return NormRegistry(entries=merged) if merged else None


def reset_registry_cache() -> None:
    _load_yaml_cached.cache_clear()
    if _db_cache_reset is not None:
        try:
            _db_cache_reset()
        except Exception:  # noqa: BLE001 — cache invalidation must never break callers
            logger.warning("norm_registry: db loader cache reset failed", exc_info=True)


def _entry_needles(entry: NormEntry) -> list[str]:
    return [needle for needle in (entry.title, entry.short, *entry.aliases, *entry.topics) if needle]


def match_entries(registry: NormRegistry, query: str) -> list[NormEntry]:
    normalized_query = _normalize(query)
    if not normalized_query:
        return []
    matches: list[NormEntry] = []
    for entry in registry.entries:
        for needle in _entry_needles(entry):
            term = _normalize(needle)
            if len(term) >= _MIN_TOPIC_LENGTH and term in normalized_query:
                matches.append(entry)
                break
    return matches


def extract_federal_state(text: str | None) -> str | None:
    if not text:
        return None
    normalized = _normalize(text)
    structured = _STRUCTURED_FEDERAL_STATE_RE.search(normalized)
    if structured:
        return FEDERAL_STATE_TOKENS.get(normalize_profile_token("federal_state", structured.group(1)))
    for state in BUNDESLAENDER:
        if _normalize(state) in normalized:
            return state
    return None


_STATES_IN_CODE_ORDER = ("Burgenland", "Kärnten", "Niederösterreich", "Oberösterreich", "Salzburg", "Steiermark")
STATE_OF_TERRITORY: dict[str, str] = {
    f"AT-{n}": state for n, state in enumerate((*_STATES_IN_CODE_ORDER, "Tirol", "Vorarlberg", "Wien"), 1)
}


def resolve_federal_state() -> str | None:
    from agent.common.knowledge_context import turn_knowledge_context

    chain = next(iter(turn_knowledge_context().chains.values()), ())
    return next((STATE_OF_TERRITORY[node] for node in chain if node in STATE_OF_TERRITORY), None)


def focus_entries(entries: list[NormEntry], federal_state: str | None) -> list[NormEntry]:
    if not federal_state:
        return entries
    kept = [entry for entry in entries if not entry.federal_state or entry.federal_state == federal_state]
    return sorted(kept, key=lambda entry: 0 if entry.federal_state == federal_state else 1)


_BLOCK_HEADER = (
    "Curated norm catalogue (verified RIS references).\n"
    "The RIS tools know this catalogue and resolve a reference themselves; an entry here\n"
    "is an address that can be named in the call, not a source location."
)

_LAW_RANKS = ("federal_law", "state_law", "ordinance")


def _render_entry_line(entry: NormEntry) -> str:
    if entry.is_ris:
        line = f"- {entry.short} — {entry.title} [{entry.application}/{entry.document_number}]"
    else:
        line = f"- {entry.short} — {entry.title}"
    if entry.federal_state:
        line += f" ({entry.federal_state})"
    if entry.full_law_url:
        line += f" Full text: {entry.full_law_url}"
    if entry.source_url:
        line += f" Source: {entry.source_url}"
    if not entry.full_law_url and not entry.source_url and not entry.is_ris:
        line += " (no full text available — reference only)"
    return line


def render_prompt_block(registry: NormRegistry, federal_state: str | None = None) -> str:
    lines = [_BLOCK_HEADER, ""]
    focused = focus_entries(registry.entries, federal_state)
    law = [entry for entry in focused if entry.rank in _LAW_RANKS]
    federal = [entry for entry in law if not entry.federal_state]
    if federal:
        lines.append("Federal law (Bundesrecht):")
        lines.extend(_render_entry_line(entry) for entry in sorted(federal, key=lambda e: e.short.lower()))
    by_state: dict[str, list[NormEntry]] = {}
    for entry in law:
        if entry.federal_state:
            by_state.setdefault(entry.federal_state, []).append(entry)
    for state in sorted(by_state, key=lambda s: (s != federal_state, s)):
        lines.append("")
        lines.append(f"State law (Landesrecht) — {state}:")
        lines.extend(_render_entry_line(entry) for entry in sorted(by_state[state], key=lambda e: e.short.lower()))
    behoerdlich = [entry for entry in focused if entry.rank == "authority_info"]
    if behoerdlich:
        lines.append("")
        lines.append("Authority information (practice notes — supplements only, never new norms):")
        lines.extend(_render_entry_line(entry) for entry in sorted(behoerdlich, key=lambda e: e.short.lower()))
    extern = [entry for entry in focused if entry.rank == "external_standard"]
    if extern:
        lines.append("")
        lines.append("External standards (referenced standards — full text usually unavailable, say so plainly):")
        lines.extend(_render_entry_line(entry) for entry in sorted(extern, key=lambda e: e.short.lower()))
    return "\n".join(lines).rstrip()


def render_block_for_prompt(norms_dir: str | None = None) -> str | None:
    from agent.common.law_gate import law_sources_withheld

    if "ris" in law_sources_withheld():
        return None
    registry = load_registry(norms_dir)
    if registry is None or not registry.entries:
        return None
    return render_prompt_block(registry, federal_state=resolve_federal_state())


_PARCEL_TAGS = ("Bebauungsplan", "Flächenwidmungsplan")


def parcel_note(available_documents: list[dict] | None) -> str | None:
    if not available_documents:
        return None
    parcel_tags = _PARCEL_TAGS
    by_tag: dict[str, list[str]] = {}
    for doc in available_documents:
        tags = doc.get("tags") or []
        name = doc.get("file_name")
        if not name:
            continue
        for tag in parcel_tags:
            if tag in tags:
                by_tag.setdefault(tag, []).append(name)
    if not by_tag:
        return None
    lines = ["## Parcel sources of this project (authoritative for zoning, building height, building lines)"]
    for tag in parcel_tags:
        if tag in by_tag:
            files = ", ".join(sorted(by_tag[tag]))
            lines.append(f"- {tag}: {files}")
    return "\n".join(lines)


_OIB_CLASS_PREFIXES: tuple[tuple[str, str], ...] = (
    ("aenderungen_", "amendment"),
    ("erlaeuterungen_", "explanatory_note"),
    ("oib-rl_begriffsbestimmungen", "definitions"),
    ("oib-rl_zitierte_normen", "referenced_standards"),
)

_RANK_LANES: dict[str, tuple[str, str]] = {
    "federal_law": ("building_law_federal", "Bundesrecht"),
    "state_law": ("building_law_state", "Landesrecht"),
    "ordinance": ("building_law_ordinance", "Verordnung"),
    "authority_info": ("authority", "Behördliche Information"),
    "external_standard": ("external_standard", "Externe Norm"),
}

_OIB_CLASS_LANES: dict[str, tuple[str, str]] = {
    "guideline": ("building_law_oib", "OIB-Richtlinie"),
    "guide": ("building_law_oib_guide", "OIB-Leitfaden"),
    "explanatory_note": ("building_law_oib_explanatory_note", "OIB-Erläuterung"),
    "definitions": ("building_law_oib_definitions", "OIB-Begriffsbestimmungen"),
    "referenced_standards": ("building_law_oib_reference", "OIB-Referenzdokument"),
    "amendment": ("building_law_oib_amendment", "OIB-Änderungsdokument"),
}

_LANE_LABELS: dict[str, str] = {
    **{key: label for key, label in _OIB_CLASS_LANES.values()},
    **{key: label for key, label in _RANK_LANES.values()},
    "building_law_ris": "Rechtsquelle (RIS)",
    "building_law_base": "Basisdokument",
    **dict.fromkeys((AGENT_AUTHORED_LANE, LEGACY_AGENT_AUTHORED_LANE), AGENT_AUTHORED_LANE_LABEL),
    MAIL_LANE: MAIL_LANE_LABEL,
    OFFICE_MAIL_LANE: MAIL_LANE_LABEL,
}


def oib_doc_class(file_name: str) -> str | None:
    name = canonical_oib_file_name(file_name)
    if not (name.startswith("oib-rl_") or name.startswith("aenderungen_") or name.startswith("erlaeuterungen_")):
        return None
    for prefix, doc_class in _OIB_CLASS_PREFIXES:
        if name.startswith(prefix):
            return doc_class
    if "leitfaden" in name:
        return "guide"
    return "guideline"


_OIB_CLASS_TO_DOC_CLASS: dict[str, str] = {
    "guideline": "oib_guideline",
    "guide": "oib_guide",
    "explanatory_note": "oib_explanatory_note",
    "definitions": "oib_definitions",
    "referenced_standards": "oib_reference",
    "amendment": "oib_amendment",
}


def guess_doc_class(file_name: str) -> str:
    from agent.knowledge.document_classification import DEFAULT_DOC_CLASS

    raw = oib_doc_class(Path(file_name).name) if file_name else None
    return _OIB_CLASS_TO_DOC_CLASS.get(raw, DEFAULT_DOC_CLASS)


_OIB_TITLE_ROLE_PREFIXES: tuple[tuple[str, str], ...] = (
    ("erlaeuterungen_", "Erläuterungen zu "),
    ("aenderungen_", "Änderungen zu "),
)

_OIB_EDITION_RE = re.compile(r"ausgabe[_-](?:([^\W\d_]+)[_-])?(\d{4})")
_UMLAUT_DIGRAPHS = (("ae", "ä"), ("oe", "ö"), ("ue", "ü"))
_OIB_REVISION_RE = re.compile(r"rev[_.]?(\d+)")
_OIB_NUMBER_RE = re.compile(r"^(\d+(?:\.\d+)?)")


def _render_edition(month: str | None, year: str) -> str:
    if not month:
        return f"Ausgabe {year}"
    word = month
    for digraph, letter in _UMLAUT_DIGRAPHS:
        word = word.replace(digraph, letter)
    return f"Ausgabe {word.capitalize()} {year}"


def guess_display_title(file_name: str) -> str | None:
    if not file_name:
        return None
    stem = Path(Path(file_name).name).stem
    low = canonical_oib_file_name(stem).replace("-leitfaden", "_leitfaden")

    role_prefix = ""
    for marker, german in _OIB_TITLE_ROLE_PREFIXES:
        if low.startswith(marker):
            role_prefix = german
            low = low[len(marker) :]
            break

    if not low.startswith("oib-rl_"):
        return None
    low = low[len("oib-rl_") :]

    edition = ""
    edition_match = _OIB_EDITION_RE.search(low)
    if edition_match:
        edition = _render_edition(edition_match.group(1), edition_match.group(2))
        low = (low[: edition_match.start()] + low[edition_match.end() :]).strip("_")

    revision = ""
    revision_match = _OIB_REVISION_RE.search(low)
    if revision_match:
        revision = f"Rev. {revision_match.group(1)}"
        low = (low[: revision_match.start()] + low[revision_match.end() :]).strip("_")

    is_guide = "leitfaden" in low
    low = low.replace("leitfaden", "").strip("_")

    if low.startswith("begriffsbestimmungen"):
        subject = "OIB-Richtlinie Begriffsbestimmungen"
    elif low.startswith("zitierte_normen"):
        subject = "OIB-Richtlinie – Zitierte Normen und sonstige technische Regelwerke"
    elif not low:
        subject = "OIB-Richtlinie"
    else:
        number_match = _OIB_NUMBER_RE.match(low)
        if not number_match:
            return None
        subject = f"OIB-Richtlinie {number_match.group(1)}"

    if is_guide:
        subject += " – Leitfaden"

    title = f"{role_prefix}{subject}"
    tail = ", ".join(part for part in (edition, revision) if part)
    return f"{title}, {tail}" if tail else title


_OIB_FAMILY_NUMBER_RE = re.compile(r"^(\d+(?:\.\d+)?)(?:[_-]|$)")


@dataclass(frozen=True)
class NormFamily:
    key: str
    members: tuple[str, ...]
    files: tuple[str, ...]

    @property
    def label(self) -> str:
        return f"OIB-Richtlinie {self.key}"


def oib_family_member(file_name: str) -> str | None:
    name = canonical_oib_file_name(Path(file_name or "").name)
    if oib_doc_class(name) != "guideline":
        return None
    match = _OIB_FAMILY_NUMBER_RE.match(name[len("oib-rl_") :])
    return match.group(1) if match else None


def _member_sort_key(member: str) -> tuple[int, ...]:
    return tuple(int(part) for part in member.split("."))


def oib_families(file_names: Iterable[str]) -> list[NormFamily]:
    by_family: dict[str, dict[str, str]] = {}
    for file_name in file_names:
        member = oib_family_member(file_name)
        if member is None:
            continue
        by_family.setdefault(member.split(".")[0], {}).setdefault(member, Path(file_name).name)
    families: list[NormFamily] = []
    for key in sorted(by_family, key=lambda k: int(k) if k.isdigit() else 0):
        members = sorted(by_family[key], key=_member_sort_key)
        families.append(NormFamily(key=key, members=tuple(members), files=tuple(by_family[key][m] for m in members)))
    return families


def _host_matches(source_url: str | None, domain: str) -> bool:
    raw = (source_url or "").strip()
    if not raw:
        return False
    if "://" not in raw:
        raw = f"https://{raw}"
    try:
        host = (urlparse(raw).hostname or "").lower()
    except ValueError:
        return False
    return host == domain or host.endswith(f".{domain}")


def lane_for_hit(
    *,
    doc_class: str | None = None,
    file_name: str | None = None,
    source_url: str | None = None,
    collection: str | None = None,
    registry: NormRegistry | None = None,
    shelf: object = None,
    authored_by: str | None = None,
    source_format: str | None = None,
) -> tuple[str, str]:
    from agent.common.provenance import is_agent_author
    from agent.common.source_kinds import Shelf
    from agent.common.source_kinds import legacy_shelf_for_collection_name
    from agent.common.source_kinds import parse_shelf

    if is_agent_author(authored_by):
        return (AGENT_AUTHORED_LANE, AGENT_AUTHORED_LANE_LABEL)
    known_shelf = parse_shelf(shelf) or legacy_shelf_for_collection_name(collection)
    if source_format == MAIL_SOURCE_FORMAT:
        return (OFFICE_MAIL_LANE if known_shelf is Shelf.OFFICE_SHELF else MAIL_LANE, MAIL_LANE_LABEL)
    users_shelf = known_shelf in (Shelf.OFFICE_SHELF, Shelf.PROJECT, Shelf.SESSION)
    if doc_class and not users_shelf:
        from agent.knowledge.document_classification import DOCUMENT_CLASS_LANES
        from agent.knowledge.document_classification import canonical_doc_class

        doc_class = canonical_doc_class(doc_class)
        if doc_class:
            lane_key = DOCUMENT_CLASS_LANES[doc_class]
            return (lane_key, _LANE_LABELS.get(lane_key, "Baurecht"))
    if known_shelf is Shelf.OFFICE_SHELF:
        return ("office", "Büroablage")
    if known_shelf is Shelf.PROJECT:
        return ("project", "Projektwissen")
    if known_shelf is Shelf.SESSION:
        return ("project", "Private Sitzung")
    return _lane_for_source(file_name=file_name, source_url=source_url, collection=collection, registry=registry)


def _lane_for_source(
    *, file_name: str | None, source_url: str | None, collection: str | None, registry: NormRegistry | None
) -> tuple[str, str]:
    if file_name:
        doc_class = oib_doc_class(Path(file_name).name)
        if doc_class:
            return _OIB_CLASS_LANES[doc_class]
    if _host_matches(source_url, "ris.bka.gv.at"):
        registry = registry if registry is not None else load_registry()  # loaded only for a RIS page
        if registry:
            for entry in registry.entries:
                if entry.document_number and entry.document_number in source_url:
                    return _RANK_LANES[entry.rank]
        return ("building_law_ris", "Rechtsquelle (RIS)")
    if _host_matches(source_url, "wien.gv.at"):
        return ("authority", "Behördliche Information")
    if collection:  # a named KB collection that is not project/office_shelf: the base corpus
        return ("building_law_oib", "OIB-Richtlinie")
    return ("web", "Web")


def lane_for_knowledge_hit(
    *,
    doc_class: str | None = None,
    file_name: str | None = None,
    source_url: str | None = None,
    collection: str | None = None,
    registry: NormRegistry | None = None,
    shelf: object = None,
    authored_by: str | None = None,
    source_format: str | None = None,
) -> tuple[str, str]:
    lane = lane_for_hit(
        doc_class=doc_class,
        file_name=file_name,
        source_url=source_url,
        collection=collection,
        registry=registry,
        shelf=shelf,
        authored_by=authored_by,
        source_format=source_format,
    )
    return ("project", "Projektwissen") if lane == ("web", "Web") else lane
