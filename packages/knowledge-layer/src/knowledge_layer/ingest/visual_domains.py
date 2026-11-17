from __future__ import annotations

import hashlib
import json
import logging
import os
from dataclasses import dataclass
from dataclasses import field
from typing import Any

logger = logging.getLogger(__name__)


class SegmentRole:
    PRIMARY = "primary"
    CHART = "chart"
    PICTORIAL = "pictorial"


_ROLE_CONTENT_TYPES = {
    SegmentRole.PRIMARY: "drawing",
    SegmentRole.CHART: "chart",
    SegmentRole.PICTORIAL: "image",
}

_ROLE_PRECEDENCE = (SegmentRole.PRIMARY, SegmentRole.CHART, SegmentRole.PICTORIAL)


ACTIVE = "active"
DEPRECATED = "deprecated"


@dataclass(frozen=True)
class SegmentType:
    key: str
    label: str
    role: str = SegmentRole.PRIMARY
    status: str = ACTIVE
    replaced_by: str | None = None


@dataclass(frozen=True)
class EntityCategory:
    key: str
    label: str
    hint: str = ""
    status: str = ACTIVE
    replaced_by: str | None = None


@dataclass(frozen=True)
class Domain:
    id: str
    label: str
    segment_types: tuple[SegmentType, ...]
    entity_categories: tuple[EntityCategory, ...]
    states: tuple[str, ...] = ()
    measure_label: str = "scale"
    applies_to: str = ""
    guidance: tuple[str, ...] = field(default_factory=tuple)

    @property
    def segment_type_keys(self) -> frozenset[str]:
        return frozenset(segment_type.key for segment_type in self.segment_types)

    @property
    def category_keys(self) -> frozenset[str]:
        return frozenset(category.key for category in self.entity_categories)

    @property
    def active_segment_types(self) -> tuple[SegmentType, ...]:
        return tuple(t for t in self.segment_types if t.status == ACTIVE)

    @property
    def active_entity_categories(self) -> tuple[EntityCategory, ...]:
        return tuple(c for c in self.entity_categories if c.status == ACTIVE)

    def role_of(self, segment_type_key: str) -> str:
        for segment_type in self.segment_types:
            if segment_type.key == segment_type_key:
                return segment_type.role
        return SegmentRole.PICTORIAL


_UNIVERSAL_CATEGORIES = (
    EntityCategory("material", "Materials", "what things are made of"),
    EntityCategory("other", "Other", ""),
)

_PICTORIAL_TYPES = (
    SegmentType("photo", "Photograph or rendering", SegmentRole.PICTORIAL),
    SegmentType("diagram", "Diagram or chart", SegmentRole.CHART),
    SegmentType("table", "Table or schedule", SegmentRole.CHART),
    SegmentType("legend", "Legend or key", SegmentRole.PICTORIAL),
    SegmentType("other", "Something else", SegmentRole.PICTORIAL),
)


ARCHITECTURE = Domain(
    id="architecture",
    label="Architecture",
    segment_types=(
        SegmentType("floor_plan", "Floor plan"),
        SegmentType("section", "Section"),
        SegmentType("elevation", "Elevation"),
        SegmentType("detail", "Construction detail"),
        SegmentType("site_plan", "Site plan"),
        SegmentType("perspective", "Perspective"),
        SegmentType("axonometric", "Axonometric"),
        *_PICTORIAL_TYPES,
    ),
    entity_categories=(
        EntityCategory("space", "Spaces and uses", "rooms, apartments, studios, plant rooms"),
        EntityCategory("circulation", "Circulation", "stairs, ramps, lifts, access decks"),
        EntityCategory("structure", "Structure", "columns, beams, slabs, grids, span direction"),
        EntityCategory("envelope", "Envelope", "facade, roof, windows, solar shading"),
        EntityCategory("services", "Building services", "heating, heat pump, ventilation, PV"),
        EntityCategory("building_physics", "Building physics", "acoustics, thermal mass, summer heat protection"),
        EntityCategory("finish", "Finishes", "plaster, exposed concrete, coatings"),
        EntityCategory("landscape", "Outdoor space", "courtyard, terrace, planting, paving"),
        *_UNIVERSAL_CATEGORIES,
    ),
    states=("existing", "new", "demolished", "reused", "transformed"),
    measure_label="scale",
    applies_to="architectural drawings, plan sheets and building documentation",
    guidance=(
        "Keep the project title, its subtitle and any graphic headline strictly apart "
        "(document.title / document.subtitle / document.slogans).",
        "Record design strategies (for example demountability, prefabrication, retaining "
        "existing fabric) in document.strategies, and ordered process steps in "
        "document.process_steps.",
    ),
)


GENERAL = Domain(
    id="general",
    label="General",
    segment_types=(
        SegmentType("drawing", "Technical drawing"),
        SegmentType("map", "Map"),
        SegmentType("screenshot", "Screenshot", SegmentRole.PICTORIAL),
        *_PICTORIAL_TYPES,
    ),
    entity_categories=(
        EntityCategory("object", "Objects", "the things depicted"),
        EntityCategory("part", "Parts", "what an object is made up of"),
        EntityCategory("person", "People and roles", ""),
        EntityCategory("place", "Places", ""),
        *_UNIVERSAL_CATEGORIES,
    ),
    applies_to="anything the other domains do not cover",
)


DOMAINS: dict[str, Domain] = {domain.id: domain for domain in (ARCHITECTURE, GENERAL)}

FALLBACK_DOMAIN_ID = GENERAL.id

DEFAULT_DOMAIN_IDS = os.environ.get("VISUAL_DOMAINS", f"{ARCHITECTURE.id},{GENERAL.id}")


@dataclass(frozen=True)
class DomainRegistry:
    domains: tuple[Domain, ...]

    @property
    def id(self) -> str:
        return "+".join(domain.id for domain in self.domains)

    @property
    def content_hash(self) -> str:
        canonical = [
            {
                "id": domain.id,
                "measure": domain.measure_label,
                "applies_to": domain.applies_to,
                "guidance": list(domain.guidance),
                "states": list(domain.states),
                "types": [[t.key, t.label, t.role] for t in domain.active_segment_types],
                "categories": [[c.key, c.label, c.hint] for c in domain.active_entity_categories],
            }
            for domain in self.domains
        ]
        payload = json.dumps(canonical, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:12]

    @property
    def fingerprint(self) -> str:
        return f"{self.id}@{self.content_hash}"

    def get(self, domain_id: str | None) -> Domain:
        for domain in self.domains:
            if domain.id == domain_id:
                return domain
        return self.fallback

    @property
    def fallback(self) -> Domain:
        for domain in self.domains:
            if domain.id == FALLBACK_DOMAIN_ID:
                return domain
        return self.domains[-1]

    @property
    def domain_ids(self) -> tuple[str, ...]:
        return tuple(domain.id for domain in self.domains)

    def segment_type_keys(self) -> tuple[str, ...]:
        seen: dict[str, None] = {}
        for domain in self.domains:
            for segment_type in domain.active_segment_types:
                seen.setdefault(segment_type.key, None)
        return tuple(seen)

    def category_keys(self) -> tuple[str, ...]:
        seen: dict[str, None] = {}
        for domain in self.domains:
            for category in domain.active_entity_categories:
                seen.setdefault(category.key, None)
        return tuple(seen)

    def state_keys(self) -> tuple[str, ...]:
        seen: dict[str, None] = {}
        for domain in self.domains:
            for state in domain.states:
                seen.setdefault(state, None)
        return tuple(seen)

    def content_type_for(self, segments: list[dict[str, Any]]) -> str:
        roles = {self.get(segment.get("domain")).role_of(segment.get("segment_type", "")) for segment in segments or []}
        for role in _ROLE_PRECEDENCE:
            if role in roles:
                return _ROLE_CONTENT_TYPES[role]
        return "image"


def resolve_registry(domain_ids: str | None = None) -> DomainRegistry:
    requested = [part.strip().lower() for part in (domain_ids or DEFAULT_DOMAIN_IDS or "").split(",")]
    selected: list[Domain] = []
    for domain_id in requested:
        if not domain_id:
            continue
        domain = DOMAINS.get(domain_id)
        if domain is None:
            logger.warning("Unknown visual domain %r; ignoring", domain_id)
        elif domain not in selected:
            selected.append(domain)

    fallback = DOMAINS[FALLBACK_DOMAIN_ID]
    if fallback not in selected:
        selected.append(fallback)
    return DomainRegistry(tuple(selected))
