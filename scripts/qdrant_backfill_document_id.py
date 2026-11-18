# drop after release 2026-W50: gives every Qdrant point with only grid_document_id the key document_id

from __future__ import annotations

import argparse
import json
import logging
import sys

from knowledge_layer.vector_store import Physical
from knowledge_layer.vector_store import backfill_document_ids
from knowledge_layer.vector_store import current_collection
from knowledge_layer.vector_store import document_id_mismatches
from knowledge_layer.vector_store import make_client

logger = logging.getLogger("qdrant_backfill_document_id")

DEFAULT_PAGE_SIZE = 500


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-8s %(message)s", stream=sys.stdout)
    parser = argparse.ArgumentParser(
        description="Give every Qdrant point that has only grid_document_id the key document_id."
    )
    parser.add_argument("physical", choices=["all", *(p.value for p in Physical)], help="Which physical collection.")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true", help="Write. Without it nothing is changed.")
    mode.add_argument("--check", action="store_true", help="A dry run that exits 1 while any point is left.")
    parser.add_argument("--page-size", type=int, default=DEFAULT_PAGE_SIZE)
    args = parser.parse_args(argv)
    physicals = list(Physical) if args.physical == "all" else [Physical(args.physical)]
    try:
        client = make_client()
        collections = {physical: current_collection(client, physical) for physical in physicals}
    except Exception as exc:  # noqa: BLE001 - unreachable and alias-less are the same hard stop
        logger.error("Could not read the aliases from Qdrant: %s", exc)
        return 2
    failing = 0
    for physical, collection in collections.items():
        count = backfill_document_ids(client, collection, apply=args.apply, page_size=args.page_size)
        disagree = document_id_mismatches(client, collection, page_size=args.page_size)
        print(
            json.dumps(
                {
                    "event": "backfill.count",
                    "backfill": "qdrant-document-id",
                    "mode": "apply" if args.apply else "check" if args.check else "dry-run",
                    "store": f"{physical.value} ({collection})",
                    "before": count.before,
                    "written": count.written,
                    "after": count.after,
                    "disagree": disagree,
                },
                separators=(",", ":"),
            ),
            flush=True,
        )
        failing += disagree + (count.after if args.apply or args.check else 0)
    return 1 if failing else 0


if __name__ == "__main__":
    sys.exit(main())
