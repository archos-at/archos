import argparse
import json
from collections.abc import Sequence
from pathlib import Path

from agent.cards.models import answer_card_adapter

SCHEMA_PATH = Path(__file__).resolve().parent.parent / "contracts" / "cards" / "schemas.json"


def generate() -> dict:
    return answer_card_adapter.json_schema()


def write(path: Path = SCHEMA_PATH) -> Path:
    schema = generate()
    contents = json.dumps(schema, indent=2, sort_keys=True) + "\n"
    path.write_text(contents, encoding="utf-8", newline="\n")
    return path


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description=f"Regenerate {SCHEMA_PATH.relative_to(SCHEMA_PATH.parents[2])} from the Pydantic card models.",
        epilog="Then run `npm run generate:cards` in apps/workspace.",
    )
    parser.parse_args(argv)
    written = write()
    print(f"Wrote Grid card JSON Schema to {written}")


if __name__ == "__main__":
    main()
