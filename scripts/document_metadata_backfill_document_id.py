# drop after release 2027-W02: keys the backend's document metadata by documents.id instead of the file name

from __future__ import annotations

import argparse
import json
import logging
import os
import sys

from knowledge_layer.vector_store import Physical
from knowledge_layer.vector_store import physical_for_scope

from agent.common.bff_http import BffError
from agent.knowledge.document_metadata_rekey import StoreCount
from agent.knowledge.document_metadata_rekey import collections_to_rekey
from agent.knowledge.document_metadata_rekey import live_documents
from agent.knowledge.document_metadata_rekey import rekey_document_ids
from agent.knowledge.document_metadata_store import DocumentMetadataStore

logger = logging.getLogger("document_metadata_backfill_document_id")

BACKFILL = "document-metadata-document-id"
DATABASE_ENV = ("SUMMARY_DB", "NAT_JOB_STORE_DB_URL")


def _database_url() -> str | None:
    return next((os.environ[name] for name in DATABASE_ENV if os.environ.get(name)), None)


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-8s %(message)s", stream=sys.stdout)
    parser = argparse.ArgumentParser(
        description="Give every metadata row of a user document the id of its document, from the BFF."
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true", help="Write. Without it nothing is changed.")
    mode.add_argument("--check", action="store_true", help="A dry run that exits 1 while any row is left.")
    args = parser.parse_args(argv)
    database_url = _database_url()
    if database_url is None:
        logger.error("None of %s names the metadata database", ", ".join(DATABASE_ENV))
        return 2
    store = DocumentMetadataStore(database_url)
    collections = [name for name in collections_to_rekey(store) if physical_for_scope(name) is Physical.OFFICE]
    try:
        counts = rekey_document_ids(store, collections, live_documents, apply=args.apply)
    except BffError as exc:
        _emit({"event": "backfill.failed", "backfill": BACKFILL, "reason": str(exc)})
        return 2
    _report("apply" if args.apply else "check" if args.check else "dry-run", len(collections), counts)
    failing = sum(count.after for count in counts) if args.apply or args.check else 0
    return 1 if failing else 0


def _emit(line: dict) -> None:
    print(json.dumps(line, separators=(",", ":")), flush=True)


def _report(mode: str, collections: int, counts: list[StoreCount]) -> None:
    for count in counts:
        _emit(
            {
                "event": "backfill.count",
                "backfill": BACKFILL,
                "mode": mode,
                "store": count.store,
                "collections": collections,
                "before": count.before,
                "written": count.written,
                "after": count.after,
                "unmatched": count.unmatched,
            }
        )
    for count in counts:
        for unmatched in count.unmatched_scopes:
            _emit(
                {
                    "event": "backfill.unmatched",
                    "backfill": BACKFILL,
                    "mode": mode,
                    "store": count.store,
                    "scope": unmatched.scope,
                    "rows": unmatched.count,
                    "reason": unmatched.reason,
                }
            )


if __name__ == "__main__":
    sys.exit(main())
