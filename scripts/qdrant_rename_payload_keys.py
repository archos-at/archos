from __future__ import annotations

import argparse
import logging
import sys
from collections import Counter

from knowledge_layer.vector_store import Physical
from knowledge_layer.vector_store import current_collection
from knowledge_layer.vector_store import legacy_remaining
from knowledge_layer.vector_store import make_client
from knowledge_layer.vector_store import rename_collection

logger = logging.getLogger("qdrant_rename_payload_keys")

DEFAULT_PAGE_SIZE = 256


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Rewrite the German payload keys of every point in place to their English names (ADR-0115)."
    )
    parser.add_argument("physical", choices=["all", *(p.value for p in Physical)], help="Which physical collection.")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true", help="Write. Without it nothing is changed.")
    mode.add_argument("--verify", action="store_true", help="Count what is left; write nothing.")
    parser.add_argument("--page-size", type=int, default=DEFAULT_PAGE_SIZE)
    return parser.parse_args(argv)


def _report_remaining(collection: str, left: Counter[str]) -> int:
    total = sum(left.values())
    for name, count in sorted(left.items()):
        logger.info("  %-40s %d", name, count)
    logger.info("%s: %s", collection, "no legacy key left" if total == 0 else f"{total} legacy value(s) left")
    return total


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-8s %(message)s", stream=sys.stdout)
    args = _parse_args(argv)
    physicals = list(Physical) if args.physical == "all" else [Physical(args.physical)]
    try:
        client = make_client()
        collections = {physical: current_collection(client, physical) for physical in physicals}
    except Exception as exc:  # noqa: BLE001 - unreachable and alias-less are the same hard stop
        logger.error("Could not read the aliases from Qdrant: %s", exc)
        return 2
    remaining = 0
    for physical, collection in collections.items():
        logger.info("%s is %s", physical.value, collection)
        if not args.verify:
            rename_collection(client, collection, apply=args.apply, page_size=args.page_size)
        if args.apply or args.verify:
            remaining += _report_remaining(collection, legacy_remaining(client, collection))
    if not args.apply and not args.verify:
        logger.info("Dry run: nothing was written. Re-run with --apply to rewrite.")
    return 1 if remaining else 0


if __name__ == "__main__":
    sys.exit(main())
