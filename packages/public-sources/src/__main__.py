"""``python -m public_sources test [source-id ...]``: validate records and run their fixtures.

What an operator's agent or an expert runs on a proposed source before it is
used. Exit status 0 only when every record parses and every fixture passes.
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from public_sources.fixtures import run_source
from public_sources.pdf import allow_parsing_here
from public_sources.source import SourceError
from public_sources.source import load_sources


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m public_sources")
    sub = parser.add_subparsers(dest="command", required=True)
    test = sub.add_parser("test", help="validate source records and run their recorded fixtures")
    test.add_argument("ids", nargs="*", help="source ids (default: every source)")
    test.add_argument("--dir", default=None, help="sources directory (default: configs/sources)")
    args = parser.parse_args(argv)
    # A developer's or CI's run of recorded fixtures, no backend role: a fixture PDF is parsed here.
    allow_parsing_here()

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
    results = [result for source in chosen for result in asyncio.run(run_source(source))]
    for result in results:
        print(f"{'ok' if result.ok else 'FAIL'}  {result.source_id}  {result.fixture}")
        print("".join(f"      {failure}\n" for failure in result.failures), end="")
        print("".join(f"      awaits its capture: {url}\n" for url in result.awaiting), end="")
    return 0 if all(result.ok for result in results) else 1


if __name__ == "__main__":
    sys.exit(main())
