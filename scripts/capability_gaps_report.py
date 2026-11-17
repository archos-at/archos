from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from agent.tools.bim.capability_gaps import ledger_path  # noqa: E402
from agent.tools.bim.capability_gaps import render_report  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(
        description="What models asked the spatial surface for and did not get — as a report."
    )
    parser.add_argument("--path", type=Path, default=None, help="ledger to read (default: CAPABILITY_GAP_LOG)")
    arguments = parser.parse_args()

    target = arguments.path or ledger_path()
    print(f"# Quelle: {target}\n", file=sys.stderr)
    print(render_report(arguments.path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
