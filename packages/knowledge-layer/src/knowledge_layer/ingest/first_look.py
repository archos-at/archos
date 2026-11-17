from __future__ import annotations

import logging
import os
from collections.abc import Callable
from collections.abc import Mapping
from typing import Any
from typing import Literal

from knowledge_layer.ingest import page_triage
from knowledge_layer.ingest.page_triage import PageSignals

logger = logging.getLogger(__name__)

FIRST_LOOK_ENV = "INGEST_PAGE_FIRST_LOOK"
MODEL_ENV = "INGEST_FIRST_LOOK_MODEL"
DEFAULT_MODEL = "openai/gpt-6-luna"
LOGO_MAX_COVERAGE = 0.05

Look = Literal["photo", "logo", "blank"]


def enabled() -> bool:
    return os.environ.get(FIRST_LOOK_ENV, "off").strip().lower() in {"on", "true", "1"}


def model() -> str:
    return os.environ.get(MODEL_ENV, "").strip() or DEFAULT_MODEL


def look_of(signals: PageSignals) -> Look | None:
    if signals.path_count >= page_triage.MIN_SKETCH_PATHS:
        return None
    if len(signals.text.strip()) >= page_triage.MIN_JUDGEABLE_CHARS:
        return None
    if signals.raster_coverage >= page_triage.MIN_SCAN_RASTER_COVERAGE:
        return None
    if signals.raster_coverage <= 0:
        return None if signals.text.strip() else "blank"
    return "logo" if signals.raster_coverage < LOGO_MAX_COVERAGE else "photo"


def split(
    drawing_pages: list[dict[str, Any]], signals: Mapping[int, PageSignals]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    full: list[dict[str, Any]] = []
    cheap: list[dict[str, Any]] = []
    for page in drawing_pages:
        measured = signals.get(page.get("page_number"))
        (cheap if measured is not None and look_of(measured) is not None else full).append(page)
    return full, cheap


def _signals(pdf_path: str, page_texts: dict[int, str], min_paths: int) -> dict[int, PageSignals]:
    measured = page_triage.read_page_signals(pdf_path, page_texts, min_paths=min_paths) or []
    return {s.page_number: s for s in measured}


def enrich(
    enrich_vlm_batch: Callable[..., tuple[list, list]],
    pdf_path: str,
    page_texts: dict[int, str],
    *,
    min_paths: int = page_triage.MIN_SKETCH_PATHS,
    **batch: Any,
) -> tuple[list, list]:
    if not enabled() or not batch.get("drawing_pages"):
        return enrich_vlm_batch(**batch)
    full, cheap = split(batch["drawing_pages"], _signals(pdf_path, page_texts, min_paths))
    if not cheap:
        return enrich_vlm_batch(**batch)
    from agent.common.openrouter import PLATFORM_FIXED
    from agent.common.openrouter import data_policy_scope

    image_results, read = enrich_vlm_batch(**{**batch, "drawing_pages": full})
    with data_policy_scope(PLATFORM_FIXED):
        _, looked = enrich_vlm_batch(**{**batch, "image_records": [], "drawing_pages": cheap, "vlm_model": model()})
    logger.info("First look: %d of %d drawing page(s) read by %s", len(cheap), len(cheap) + len(full), model())
    return image_results, sorted([*read, *looked], key=lambda page: page.get("page_number", 0))
