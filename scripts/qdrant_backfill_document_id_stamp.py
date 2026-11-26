# drop after release 2027-W02: gives every user-document point with neither id key the id of its document

from __future__ import annotations

import argparse
import json
import logging
import sys

from knowledge_layer.vector_store import Physical
from knowledge_layer.vector_store import current_collection
from knowledge_layer.vector_store import make_client
from knowledge_layer.vector_store import stamp_document_ids

from agent.common.bff_http import BffError
from agent.knowledge.document_metadata_rekey import live_documents

logger = logging.getLogger("qdrant_backfill_document_id_stamp")

BACKFILL = "qdrant-document-id-stamp"
DEFAULT_PAGE_SIZE = 500


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-8s %(message)s", stream=sys.stdout)
    parser = argparse.ArgumentParser(
        description="Give every user-document point with neither document_id nor grid_document_id its document's id."
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true", help="Write. Without it nothing is changed.")
    mode.add_argument("--check", action="store_true", help="A dry run that exits 1 while any point is left.")
    parser.add_argument("--page-size", type=int, default=DEFAULT_PAGE_SIZE)
    args = parser.parse_args(argv)
    try:
        client = make_client()
        collection = current_collection(client, Physical.OFFICE)
    except Exception as exc:  # noqa: BLE001 - unreachable and alias-less are the same hard stop
        logger.error("Could not read the office alias from Qdrant: %s", exc)
        return 2
    try:
        count = stamp_document_ids(client, collection, live_documents, apply=args.apply, page_size=args.page_size)
    except BffError as exc:
        print(
            json.dumps({"event": "backfill.failed", "backfill": BACKFILL, "reason": str(exc)}, separators=(",", ":")),
            flush=True,
        )
        return 2
    print(
        json.dumps(
            {
                "event": "backfill.count",
                "backfill": BACKFILL,
                "mode": "apply" if args.apply else "check" if args.check else "dry-run",
                "store": f"{Physical.OFFICE.value} ({collection})",
                "scopes": count.scopes,
                "before": count.before,
                "written": count.written,
                "after": count.after,
                "unmatched": count.unmatched,
            },
            separators=(",", ":"),
        ),
        flush=True,
    )
    return 1 if count.after and (args.apply or args.check) else 0


if __name__ == "__main__":
    sys.exit(main())
