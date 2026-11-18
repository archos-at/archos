#!/usr/bin/env python3

import sys
from pathlib import Path

BYTE_ORDER_MARK = 0xFEFF

FORBIDDEN = {
    0x200B,  # zero-width space
    0x2060,  # word joiner
    BYTE_ORDER_MARK,  # zero-width no-break space, allowed only at offset 0
    *range(0x202A, 0x202F),  # bidi embeddings and overrides
    *range(0x2066, 0x206A),  # bidi isolates
}


def find_hidden(text: str) -> list[tuple[int, int, int]]:
    hits = []
    for index, char in enumerate(text):
        code = ord(char)
        if code not in FORBIDDEN or (code == BYTE_ORDER_MARK and index == 0):
            continue
        line = text.count("\n", 0, index) + 1
        column = index - text.rfind("\n", 0, index)
        hits.append((line, column, code))
    return hits


def main(paths: list[str]) -> int:
    failures = 0
    for name in paths:
        if not Path(name).is_file():  # a deleted path, as `git ls-files` lists it
            continue
        raw = Path(name).read_bytes()
        if b"\x00" in raw[:8192]:
            continue
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            continue
        for line, column, code in find_hidden(text):
            print(f"{name}:{line}:{column}: U+{code:04X} is invisible; write the escape \\u{code:04X} instead")
            failures += 1
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
