"""What makes a German social-insurance number or tax identification number: the content screen's German rules.

Pure, and a leaf, like :mod:`agent.common.svnr_numbers` (the Austrian
social-security number): :mod:`agent.common.content_screen` parses where a
number is printed and asks this module whether it is one. The TypeScript twin
is ``apps/workspace/bff/upload-screening/de-numbers.ts``; both are held to the
shared fixture ``tests/fixtures/content_screen_cases.json``.

* ``de_svnr``, the Rentenversicherungsnummer (``15 070649 C 103``): the area
  (two digits), the birth date DDMMYY, the first letter of the birth name, a
  serial of two digits and a check digit. The letter becomes its two-digit
  place in the alphabet; each of the twelve digits is multiplied by
  ``2 1 2 5 7 1 2 1 2 1 2 1``, the products' digit sums are added, and the sum
  mod 10 is the check digit. The letter in the middle is what makes the shape
  rare, so no label is needed.
* ``de_tax_id``, the steuerliche Identifikationsnummer (``36 574 261 809``):
  eleven digits, never a leading zero; in the first ten, exactly one digit
  repeats, two or three times; the last is ISO 7064 MOD 11,10. Eleven digits
  are a phone, order or meter number as often, and about one in eleven of them
  passes, so it counts only with a tax-ID label on the page (:data:`TAX_ID_LABELS`).

``python-stdnum``'s ``de.idnr`` is the oracle the tests hold :func:`valid_de_tax_id`
to; it has no Rentenversicherungsnummer.
"""

from __future__ import annotations

from agent.common.screen_chars import _digit_touches
from agent.common.screen_chars import _digits_at
from agent.common.screen_chars import _skip_separator

_RVNR_WEIGHTS = (2, 1, 2, 5, 7, 1, 2, 1, 2, 1, 2, 1)

#: Labels of a German tax identification number, folded (``content_screen.fold``), matched at a word start.
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
    """A Rentenversicherungsnummer, compact (``15070649C103``): shape, area, birth day and month, check digit. Pure."""
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
    """A steuerliche Identifikationsnummer: eleven digits, no leading zero, one repeated digit, MOD 11,10. Pure."""
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


# ------------------------------------------------------------------ parsers


def de_svnr_at(text: str, start: int, soft: frozenset[int]) -> tuple[str, int] | None:
    """The Rentenversicherungsnummer printed at ``start``: its compact form and where it ends.

    ``AA DDMMYY L SS C``: whitespace may stand after the area, after the date,
    after the letter and before the check digit (``15 070649 C 103``,
    ``15070649C103``). The letter is an ASCII capital.
    """
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
    """The tax identification number printed at ``start``: its eleven digits and where it ends.

    Unbroken, or in groups of 2-3-3-3 joined by whitespace (``36 574 261 809``).
    """
    first = _digits_at(text, start, 2)
    if first is None:
        return None
    unbroken = _digits_at(text, start, 11)
    if unbroken is not None:
        digits, end = unbroken, start + 11
    else:
        parts, index = [first], start + 2
        for width in (3, 3, 3):
            group_at = _skip_separator(text, index, "")
            group = _digits_at(text, group_at, width) if group_at > index else None
            if group is None:
                return None
            parts.append(group)
            index = group_at + width
        digits, end = "".join(parts), index
    if _digit_touches(text, end, soft) or not valid_de_tax_id(digits):
        return None
    return digits, end
