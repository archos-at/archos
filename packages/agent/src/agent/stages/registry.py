from __future__ import annotations

import logging

from agent.stages.spec import StageSpec

logger = logging.getLogger(__name__)

_STAGES: dict[str, StageSpec] = {}


def register_stage(spec: StageSpec) -> StageSpec:
    existing = _STAGES.get(spec.id)
    if existing is not None and existing is not spec:
        raise ValueError(f"a different stage is already registered under id {spec.id!r}")
    _STAGES[spec.id] = spec
    return spec


def iter_stages() -> tuple[StageSpec, ...]:
    return tuple(_STAGES.values())


def get_stage(stage_id: str) -> StageSpec | None:
    return _STAGES.get(stage_id)


def unregister_stage(stage_id: str) -> StageSpec | None:
    return _STAGES.pop(stage_id, None)
