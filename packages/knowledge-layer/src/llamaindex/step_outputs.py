"""JSON parts one document version's ingest steps hand each other, stored beside ``parsed.json``.

The page fan-out (``INGEST_PAGE_FAN_OUT``: ``extract``, ``read_page``,
``assembly``, ``enrich``) runs a file in steps that may land on different
workers, and a step's output in the orchestrator carries only references. What
a step produced for the next one is written here, under the version's ``_text/``
directory, through the same BFF-presigned PUT as
``parsed.json`` (``page_text_store.request_slot``), and read back with the
backend's read-only credential:

``page-reads/<n>.json``
    What page ``n``'s task read: the vision-cache answers it got, keyed as the
    pipeline asks for them, and whether the page was read.
``enrichment.json``
    What the summary, tags, topics and dossier read (``ingest_enrichment``'s
    inputs), written by the step that wrote the chunks.
``enrichment/<name>.json``
    One enrichment call's answer.

Every part names the file's content hash and is ignored for any other, so a
newer version never reads an older one's part. Bounded by
``INGEST_PARSED_MAX_BYTES`` like ``parsed.json``, and fail-open: a part that
cannot be written or read is a step that does its work again.
"""

from __future__ import annotations

import dataclasses
import json
import logging
import re
from typing import Any

from . import parsed_store

logger = logging.getLogger(__name__)

SCHEMA_VERSION = 1
ENRICHMENT_PART = "enrichment.json"
ENRICHMENT_NAMES = ("summary", "tags", "topics", "dossier")
#: The parts the BFF presigns beside ``parsed.json`` (``STEP_OUTPUT_PART_PATTERN`` in ``bff/s3.ts``).
PART_PATTERN = re.compile(
    r"^(?:page-reads/[1-9][0-9]{0,4}\.json|enrichment\.json|enrichment/(?:summary|tags|topics|dossier)\.json)$"
)


def page_part(page: int) -> str:
    return f"page-reads/{int(page)}.json"


def enrichment_part(name: str) -> str:
    if name not in ENRICHMENT_NAMES:
        raise ValueError(f"no enrichment part {name!r}")
    return f"enrichment/{name}.json"


@dataclasses.dataclass
class StepOutputs:
    """One document version's parts; inert without a document id. The seams are ``parsed_store``'s."""

    document_id: str | None
    collection: str
    organization_id: str | None
    content_hash: str
    presign: parsed_store.Presigner | None = None
    fetch: parsed_store.Fetcher | None = None
    upload: parsed_store.Uploader | None = None

    def _slot(self, part: str) -> Any:
        from . import page_text_store

        if not self.document_id or parsed_store.PARSED_MAX_BYTES <= 0 or not PART_PATTERN.match(part):
            return None
        presign = self.presign or page_text_store.request_slot
        return presign(self.document_id, self.collection, part, self.organization_id)

    def put(self, part: str, data: Any) -> bool:
        """Write ``data`` as ``part`` of this version; whether it landed. Never raises."""
        from . import page_text_store

        body = json.dumps(
            {"schema_version": SCHEMA_VERSION, "content_hash": self.content_hash, "data": data},
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        if len(body) > parsed_store.PARSED_MAX_BYTES:
            logger.warning("step_outputs: %s of %s not stored: %d bytes", part, self.document_id, len(body))
            return False
        try:
            slot = self._slot(part)
            if slot is None:
                return False
            (self.upload or page_text_store.put_part)(slot.upload_url, body, "application/json")
            return True
        except Exception as exc:  # noqa: BLE001 - fail-open: the reader does the work again
            logger.warning("step_outputs: storing %s of %s failed (%s)", part, self.document_id, type(exc).__name__)
            return False

    def get(self, part: str) -> Any:
        """``part``'s data when it is this version's, else ``None``. Never raises."""
        try:
            slot = self._slot(part)
            if slot is None or not getattr(slot, "storage_key", None):
                return None
            raw = (self.fetch or parsed_store._fetch)(getattr(slot, "storage_bucket", None), slot.storage_key)
            if raw is None or len(raw) > parsed_store.PARSED_MAX_BYTES:
                return None
            body = json.loads(raw)
        except Exception as exc:  # noqa: BLE001 - no part: the reader does the work again
            logger.info("step_outputs: %s of %s not read (%s)", part, self.document_id, type(exc).__name__)
            return None
        if not isinstance(body, dict) or body.get("schema_version") != SCHEMA_VERSION:
            return None
        if body.get("content_hash") != self.content_hash:
            return None
        return body.get("data")


def for_job(prepared: Any, content_hash: str) -> StepOutputs:
    """The step outputs of a one-file job's version: its document, collection and organization."""
    config = prepared.config
    return StepOutputs(
        str(config.get("document_id") or ""), prepared.collection_name, config.get("organization_id"), content_hash
    )
