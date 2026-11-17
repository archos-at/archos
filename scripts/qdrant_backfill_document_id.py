"""Give every Qdrant point with only ``grid_document_id`` the key ``document_id``: drop after release 2026-W50."""

from __future__ import annotations

import argparse
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
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("physical", choices=["all", *(p.value for p in Physical)], help="Which physical collection.")
    parser.add_argument("--apply", action="store_true", help="Write. Without it nothing is changed.")
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
        logger.info(
            "%s (%s): %d with only the old key before, %d written, %d left, %d with two different values",
            physical.value,
            collection,
            count.before,
            count.written,
            count.after,
            disagree,
        )
        failing += disagree + (count.after if args.apply else 0)
    if not args.apply:
        logger.info("Dry run: nothing was written. Re-run with --apply to write.")
    return 1 if failing else 0


if __name__ == "__main__":
    sys.exit(main())
