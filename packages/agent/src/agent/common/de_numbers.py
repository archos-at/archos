from __future__ import annotations

from agent.common.screen_chars import _digit_touches
from agent.common.screen_chars import _digits_at
from agent.common.screen_chars import _skip_separator

_RVNR_WEIGHTS = (2, 1, 2, 5, 7, 1, 2, 1, 2, 1, 2, 1)

TAX_ID_LABELS: tuple[str, ...] = (
    "steuer-id",
    "steuer id",
    "steuerid",
    "steuer-idnr",
    "steueridentifikationsnummer",
    "steuerliche identifikationsnummer",
    "identifikationsnummer",
    "idnr",
)


def _digit_sum(value: int) -> int:
    return sum(int(digit) for digit in str(value))


def valid_de_svnr(compact: str) -> bool:
    if len(compact) != 12 or not compact.isascii():
        return False
    head, letter, tail = compact[:8], compact[8], compact[9:]
    if not (head.isdigit() and tail.isdigit() and "A" <= letter <= "Z"):
        return False
    area, day, month = int(head[:2]), int(head[2:4]), int(head[4:6])
    if not (2 <= area <= 89 and 1 <= day <= 31 and 1 <= month <= 12):
        return False
    digits = head + f"{ord(letter) - ord('A') + 1:02d}" + tail[:2]
    total = sum(_digit_sum(int(d) * w) for d, w in zip(digits, _RVNR_WEIGHTS, strict=True))
    return total % 10 == int(tail[2])


def valid_de_tax_id(digits: str) -> bool:
    if len(digits) != 11 or not digits.isascii() or not digits.isdigit() or digits[0] == "0":
        return False
    counts: dict[str, int] = {}
    for digit in digits[:10]:
        counts[digit] = counts.get(digit, 0) + 1
    repeated = [count for count in counts.values() if count > 1]
    if len(repeated) != 1 or repeated[0] not in (2, 3):
        return False
    product = 10
    for digit in digits[:10]:
        total = (int(digit) + product) % 10 or 10
        product = (2 * total) % 11
    return (11 - product) % 10 == int(digits[10])


def mask_de_svnr(compact: str) -> str:
    return f"•• •••••• • •{compact[-2:]}"


def mask_de_tax_id(digits: str) -> str:
    return f"•• ••• ••• •{digits[-2:]}"




def de_svnr_at(text: str, start: int, soft: frozenset[int]) -> tuple[str, int] | None:
    area = _digits_at(text, start, 2)
    date_at = _skip_separator(text, start + 2, "")
    date = _digits_at(text, date_at, 6)
    letter_at = _skip_separator(text, date_at + 6, "")
    letter = text[letter_at] if letter_at < len(text) and "A" <= text[letter_at] <= "Z" else None
    serial_at = _skip_separator(text, letter_at + 1, "")
    serial = _digits_at(text, serial_at, 2)
    check_at = _skip_separator(text, serial_at + 2, "")
    check = _digits_at(text, check_at, 1)
    if area is None or date is None or letter is None or serial is None or check is None:
        return None
    end = check_at + 1
    compact = f"{area}{date}{letter}{serial}{check}"
    if _digit_touches(text, end, soft) or not valid_de_svnr(compact):
        return None
    return compact, end


def de_tax_id_at(text: str, start: int, soft: frozenset[int]) -> tuple[str, int] | None:
    unbroken = _digits_at(text, start, 11)
    found = (unbroken, start + 11) if unbroken is not None else _grouped_tax_id(text, start)
    if found is None or _digit_touches(text, found[1], soft) or not valid_de_tax_id(found[0]):
        return None
    return found


def _grouped_tax_id(text: str, start: int) -> tuple[str, int] | None:
    first = _digits_at(text, start, 2)
    if first is None:
        return None
    parts, index = [first], start + 2
    for width in (3, 3, 3):
        group_at = _skip_separator(text, index, "")
        group = _digits_at(text, group_at, width) if group_at > index else None
        if group is None:
            return None
        parts.append(group)
        index = group_at + width
    return "".join(parts), index
