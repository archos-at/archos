"""What makes ten digits an Austrian social-security number: the content screen's SVNR rules.

Pure, and a leaf, like :mod:`agent.common.card_numbers`:
:mod:`agent.common.content_screen` parses where a number is printed and asks
this module whether it is one. The TypeScript twin is
``apps/workspace/bff/upload-screening/svnr-numbers.ts``; both are held to the
shared fixture ``tests/fixtures/content_screen_cases.json``.

A number is ``SSSS DDMMYY``: a serial whose fourth digit checks the other nine
(mod 11), then the birth date. One ten-digit number in about 250 passes that, so
the shape around it decides as much as the checksum does:

* The date's parts are joined, or all split by the SAME separator
  (``01.01.80``, ``01 01 80``). A timestamp mixes them: ``2026-09-12 10:17`` read
  as serial ``2026`` and birth date ``09-12 10`` passed one time in sixteen, and
  held every spreadsheet with a column of dates.
* A ``:`` after it makes its last two digits an hour.
* Printed UNBROKEN (``1237010180``), it is any ten-digit customer, receipt or
  Unix-time number too, so it counts only with a social-security label on the
  page (:data:`SVNR_LABELS`): a staff list names its column once, in the header.
"""

from __future__ import annotations

_SVNR_WEIGHTS = (3, 7, 9, 0, 5, 8, 4, 2, 1, 6)

#: Labels of a social-security number, folded (``content_screen.fold``), matched at a word start.
SVNR_LABELS: tuple[str, ...] = (
    "svnr",
    "sv-nr",
    "sv nr",
    "sv-nummer",
    "svnummer",
    "sozialversicherung",
    "versicherungsnummer",
    "versicherungsnr",
    "vsnr",
)


def valid_at_svnr(digits: str) -> bool:
    """An Austrian social-security number: check digit, first digit, birth day and month. Pure.

    The check digit (4th) is the weighted sum of the other nine mod 11; a sum
    giving 10 is never issued. Months 13-15 stand for an unknown birth month.
    """
    if len(digits) != 10 or not digits.isascii() or not digits.isdigit() or digits[0] == "0":
        return False
    check = sum(int(d) * w for d, w in zip(digits, _SVNR_WEIGHTS, strict=True)) % 11
    if check == 10 or check != int(digits[3]):
        return False
    day, month = int(digits[4:6]), int(digits[6:8])
    return 1 <= day <= 31 and 1 <= month <= 15


def printed_as_svnr(date_separators: tuple[str, str], time_follows: bool) -> bool:
    """Whether the shape around ten valid digits is a social-security number's, not a timestamp's. Pure.

    ``date_separators`` are the separators between the date's day and month and
    between its month and year, each ``""`` (joined), ``" "`` (any whitespace)
    or the mark itself. ``time_follows``: a ``:`` and a digit stand right after the year.
    """
    return date_separators[0] == date_separators[1] and not time_follows


def mask_at_svnr(digits: str) -> str:
    return f"•••• ••••{digits[-2:]}"
