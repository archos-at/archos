"""The cheap first look: which pages it takes, that it is off by default, and that off changes nothing."""

from __future__ import annotations

import pytest
from knowledge_layer.ingest import first_look
from knowledge_layer.ingest.page_triage import PageSignals

from agent.common import openrouter


def _page(number: int, *, text: str = "", paths: int = 0, raster: float = 0.0) -> PageSignals:
    return PageSignals(page_number=number, text=text, path_count=paths, raster_coverage=raster)


@pytest.mark.parametrize(
    ("signals", "look"),
    [
        (_page(1), "blank"),
        (_page(1, raster=0.01), "logo"),
        (_page(1, raster=0.3), "photo"),
        (_page(1, raster=0.3, paths=500), None),  # a plan with a photo on it
        (_page(1, paths=25), None),  # a sketch
        (_page(1, raster=0.9), None),  # a scan: transcription's
        (_page(1, text="Grundriss Erdgeschoss, Maßstab 1:100, Bauvorhaben Wohnhaus", raster=0.3), None),
        (_page(1, text="EG"), None),  # a label on an empty page: not blank
    ],
)
def test_the_first_look_takes_pictures_and_empty_pages_only(signals, look):
    assert first_look.look_of(signals) == look


def test_it_is_off_unless_switched_on(monkeypatch):
    monkeypatch.delenv(first_look.FIRST_LOOK_ENV, raising=False)
    assert first_look.enabled() is False
    monkeypatch.setenv(first_look.FIRST_LOOK_ENV, "on")
    assert first_look.enabled() is True


def test_its_model_defaults_to_the_cheapest_image_capable_model_configs_name(monkeypatch):
    monkeypatch.delenv(first_look.MODEL_ENV, raising=False)
    assert first_look.model() == first_look.DEFAULT_MODEL
    monkeypatch.setenv(first_look.MODEL_ENV, "vendor/cheap-vision")
    assert first_look.model() == "vendor/cheap-vision"


class _Batch:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def __call__(self, **batch):
        self.calls.append(
            {**batch, "policy": openrouter.scoped_data_policy(), "scoped": openrouter._scoped_policy.get()}
        )
        return [("image", batch["vlm_model"])] if batch["image_records"] else [], [
            {**page, "model": batch["vlm_model"]} for page in batch["drawing_pages"]
        ]


def _batch(pages):
    return {
        "image_records": ["raster"],
        "drawing_pages": [{"page_number": n} for n in pages],
        "vlm_model": "full/vision",
        "vlm_base_url": "https://openrouter.ai/api/v1",
        "vlm_api_key": "k",
        "extract_charts": True,
    }


def test_off_it_is_the_one_call_it_replaces(monkeypatch):
    monkeypatch.delenv(first_look.FIRST_LOOK_ENV, raising=False)
    batch = _Batch()

    first_look.enrich(batch, "/unread.pdf", {}, **_batch([1, 2]))

    assert len(batch.calls) == 1
    assert batch.calls[0]["vlm_model"] == "full/vision"


def test_on_the_pictures_go_to_the_cheaper_model_pinned_and_the_pages_stay_in_order(monkeypatch):
    monkeypatch.setenv(first_look.FIRST_LOOK_ENV, "on")
    monkeypatch.setenv(first_look.MODEL_ENV, "vendor/cheap-vision")
    measured = {1: _page(1, paths=900), 2: _page(2, raster=0.2), 3: _page(3, paths=400)}
    monkeypatch.setattr(first_look, "_signals", lambda pdf, texts, min_paths: measured)
    batch = _Batch()

    images, pages = first_look.enrich(batch, "/plan.pdf", {}, **_batch([1, 2, 3]))

    full, cheap = batch.calls
    assert [p["page_number"] for p in full["drawing_pages"]] == [1, 3]
    assert (cheap["vlm_model"], cheap["image_records"], cheap["scoped"]) == (
        "vendor/cheap-vision",
        [],
        openrouter.PLATFORM_FIXED,
    )
    assert [(p["page_number"], p["model"]) for p in pages] == [
        (1, "full/vision"),
        (2, "vendor/cheap-vision"),
        (3, "full/vision"),
    ]
    assert images == [("image", "full/vision")]
