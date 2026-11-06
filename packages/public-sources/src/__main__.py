"""``python -m public_sources test [source-id ...]``: validate records and run their fixtures.

What an operator's agent or an expert runs on a proposed source before it is
used. Exit status 0 only when every record parses and every fixture passes.
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from public_sources.fixtures import run_source
from public_sources.source import SourceError
from public_sources.source import load_sources


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m public_sources")
    sub = parser.add_subparsers(dest="command", required=True)
    test = sub.add_parser("test", help="validate source records and run their recorded fixtures")
    test.add_argument("ids", nargs="*", help="source ids (default: every source)")
    test.add_argument("--dir", default=None, help="sources directory (default: configs/sources)")
    args = parser.parse_args(argv)

    try:
        sources = load_sources(args.dir)
    except SourceError as exc:
        print(f"invalid: {exc}", file=sys.stderr)
        return 1
    chosen = [sources[i] for i in args.ids if i in sources] if args.ids else list(sources.values())
    unknown = [i for i in args.ids if i not in sources]
    if unknown:
        print(f"unknown source ids: {unknown}", file=sys.stderr)
        return 1
    failed = 0
    for source in chosen:
        for result in asyncio.run(run_source(source)):
            status = "ok" if result.ok else "FAIL"
            print(f"{status}  {source.id}  {result.fixture}")
            for failure in result.failures:
                print(f"      {failure}")
            failed += not result.ok
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
