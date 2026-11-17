from __future__ import annotations

import argparse
import logging
import sys

from knowledge_layer.vector_store import LENGTH_SAMPLE
from knowledge_layer.vector_store import Physical
from knowledge_layer.vector_store import bm25_length_of
from knowledge_layer.vector_store import current_collection
from knowledge_layer.vector_store import effective_bm25_length
from knowledge_layer.vector_store import make_client
from knowledge_layer.vector_store import measure_lengths
from knowledge_layer.vector_store import tuned_length

logger = logging.getLogger("qdrant_chunk_length_stats")


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Measure the BM25 length of the chunks in each Qdrant collection, read-only (ADR-0127)."
    )
    parser.add_argument("physical", nargs="*", choices=[p.value for p in Physical], help="Which collections (both).")
    parser.add_argument("--sample", type=int, default=LENGTH_SAMPLE, help="Chunks read per collection.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.WARNING, format="%(message)s", stream=sys.stderr)
    args = _parse_args(argv)
    physicals = [Physical(name) for name in args.physical] or list(Physical)
    try:
        client = make_client()
        for physical in physicals:
            live = current_collection(client, physical)
            length = effective_bm25_length(bm25_length_of(client.get_collection(live).config.metadata))
            stats = measure_lengths(client, live, args.sample)
            if stats is None:
                print(f"{physical.value} ({live}): no chunk with a lexical vector")
                continue
            tuned = tuned_length(stats, length)
            print(f"{stats.line()}, written with {length}; a rebuild would write {tuned}")
    except Exception as exc:  # noqa: BLE001 - unreachable and alias-less are the same hard stop
        logger.error("Could not read from Qdrant: %s", exc)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
