import argparse
import json
from collections.abc import Sequence
from pathlib import Path
from typing import get_args

from public_sources.access import ACCESS_TYPES
from public_sources.engines import ENGINES

from agent.cards.workspace_cards import TaskKind
from agent.common.source_kinds import SOURCE_KINDS
from agent.common.source_kinds import Shelf

OUT_PATH = Path(__file__).resolve().parent.parent / "apps" / "workspace" / "shared" / "vocabularies.generated.ts"

VOCABULARIES: tuple[tuple[str, tuple[str, ...], str], ...] = (
    (
        "DELEGATABLE_TASK_KINDS",
        get_args(TaskKind),
        "The kinds a person may delegate: `TaskKind` in `packages/agent/src/agent/cards/workspace_cards.py`.",
    ),
    (
        "SOURCE_KINDS",
        tuple(SOURCE_KINDS),
        "The coarse source kinds: the keys of `SOURCE_KINDS` in `packages/agent/src/agent/common/source_kinds.py`.",
    ),
    (
        "SHELVES",
        tuple(shelf.value for shelf in Shelf),
        "The shelves a retrieved chunk can come from: `Shelf` in `packages/agent/src/agent/common/source_kinds.py`.",
    ),
    (
        "SOURCE_PROTOCOLS",
        tuple(ACCESS_TYPES),
        "A source record's protocols: the keys of `ACCESS_TYPES` in "
        "`packages/public-sources/src/public_sources/access`.",
    ),
    (
        "SOURCE_FORMATS",
        tuple(ENGINES),
        "A source record's formats: the keys of `ENGINES` in `packages/public-sources/src/public_sources/engines`.",
    ),
)


def render() -> str:
    blocks = [
        "// AUTO-GENERATED from the Python sources named below — do not edit; "
        "run `uv run python scripts/generate_vocabularies.py`"
    ]
    for name, members, doc in VOCABULARIES:
        values = ", ".join(json.dumps(value) for value in members)
        blocks.append(f"/** {doc} */\nexport const {name} = [{values}] as const")
    return "\n\n".join(blocks) + "\n"


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description=f"Regenerate {OUT_PATH.relative_to(OUT_PATH.parents[4])} from the Python sources."
    )
    parser.parse_args(argv)
    OUT_PATH.write_text(render(), encoding="utf-8", newline="\n")
    print(f"Wrote the shared vocabularies to {OUT_PATH}")


if __name__ == "__main__":
    main()
