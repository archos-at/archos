import argparse
import json
from collections.abc import Sequence
from pathlib import Path

from agent.common.wire_v2 import wire_json_schema

SCHEMA_PATH = Path(__file__).resolve().parent.parent / "contracts" / "wire" / "v2.schema.json"


def render() -> str:
    return json.dumps(wire_json_schema(), indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description=f"Regenerate {SCHEMA_PATH.relative_to(SCHEMA_PATH.parents[2])} from the Pydantic wire models.",
        epilog="Then run `npm run generate:wire` in apps/workspace.",
    )
    parser.parse_args(argv)
    SCHEMA_PATH.parent.mkdir(parents=True, exist_ok=True)
    SCHEMA_PATH.write_text(render(), encoding="utf-8", newline="\n")
    print(f"Wrote the chat wire v2 JSON Schema to {SCHEMA_PATH}")


if __name__ == "__main__":
    main()
