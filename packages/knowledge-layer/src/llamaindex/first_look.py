"""A cheap first look: pages that only hold a picture go to a cheaper vision model. Shipped off.

Page triage (``page_triage``) sends every page with little text and any
picture or linework to the vision model as a drawing. Most of those are
plans, but some only carry a photo, a logo or nothing at all: a cover sheet
with the office's mark, a site photo pasted onto a page, an empty back side
with a scanner's speck. Reading those with the full vision model costs what a
plan costs and says little more than a cheaper one would.

With ``INGEST_PAGE_FIRST_LOOK=on`` such a page is analysed by
``INGEST_FIRST_LOOK_MODEL`` instead. The decision (:func:`look_of`) is pure,
over the signals triage already measures for the page (:class:`PageSignals`):

``blank``
    No text, no linework, no raster. Triage already keeps such a page from
    the vision model (it is ``text``); named here so a later triage that
    renders it cannot send it to the full model.
``logo``
    Little text, fewer paths than a sketch (``MIN_SKETCH_PATHS``) and a raster
    covering less than ``LOGO_MAX_COVERAGE`` of the page: a mark, a stamp.
``photo``
    The same with a larger raster: a picture on a page (a full-page raster is
    a scan, which ``transcription`` reads, never this).

Everything with linework stays on the full model: a plan is what the vision
model is for. The model is a platform choice no organisation makes, so its
calls are pinned to zero data retention (``openrouter.PLATFORM_FIXED``).

**Off until the answer suite has run.** What a page is read as shapes what
the index holds and so what an answer cites (``task be:eval:answer-suite``,
``docs/contributing/testing-and-verification.md``). The default stays ``off``
until a before-and-after report says the cheaper reading loses nothing.

**Where it is called.** The hand-over from triage to the vision model is in
``adapter.py`` (the ``vision`` stage, ``_processing.enrich_vlm_batch``),
which this change does not edit. The call site, replacing that one call::

    from knowledge_layer.llamaindex import first_look

    image_results, drawing_pages = first_look.enrich(
        _processing.enrich_vlm_batch, source_path, page_texts_for_visual_heuristic(text_pages),
        image_records=images, drawing_pages=drawing_pages_raw, vlm_model=vlm_model,
        vlm_base_url=vlm_base_url, vlm_api_key=vlm_api_key, extract_charts=extract_charts,
    )

:func:`enrich` is that call unchanged while the knob is off.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Callable
from collections.abc import Mapping
from typing import Any
from typing import Literal

from knowledge_layer.llamaindex import page_triage
from knowledge_layer.llamaindex.page_triage import PageSignals

logger = logging.getLogger(__name__)

FIRST_LOOK_ENV = "INGEST_PAGE_FIRST_LOOK"
MODEL_ENV = "INGEST_FIRST_LOOK_MODEL"
#: The cheapest image-capable model ``configs/`` names. Today that is the only
#: one, the vision model itself (``configs/config_oib_openrouter.yml``,
#: ``VLM_MODEL``), so the knob does nothing until a cheaper model with a
#: zero-data-retention endpoint is named here or in ``INGEST_FIRST_LOOK_MODEL``.
DEFAULT_MODEL = "openai/gpt-6-luna"
#: Below this share of the page a picture is a mark (a logo, a stamp), above it a photo.
LOGO_MAX_COVERAGE = 0.05

Look = Literal["photo", "logo", "blank"]


def enabled() -> bool:
    """``INGEST_PAGE_FIRST_LOOK``: ``on`` (or ``true``, ``1``) turns the first look on; anything else is off."""
    return os.environ.get(FIRST_LOOK_ENV, "off").strip().lower() in {"on", "true", "1"}


def model() -> str:
    """``INGEST_FIRST_LOOK_MODEL``, or :data:`DEFAULT_MODEL`."""
    return os.environ.get(MODEL_ENV, "").strip() or DEFAULT_MODEL


def look_of(signals: PageSignals) -> Look | None:
    """What a page holds that the first look reads, or None for a page the full model reads. Pure."""
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
    """``drawing_pages`` as (for the full model, for the first look), each in page order. Pure."""
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
    """``enrich_vlm_batch(**batch)``, with the pages :func:`look_of` names read by :func:`model` when on.

    Off, or with nothing for the first look, it is the one call it replaces.
    On, the pictures go in a second batch on the cheaper model, pinned to zero
    data retention; the drawing pages come back in page order either way.
    """
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
