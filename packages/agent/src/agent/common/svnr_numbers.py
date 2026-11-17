from __future__ import annotations

_SVNR_WEIGHTS = (3, 7, 9, 0, 5, 8, 4, 2, 1, 6)

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
    if len(digits) != 10 or not digits.isascii() or not digits.isdigit() or digits[0] == "0":
        return False
    check = sum(int(d) * w for d, w in zip(digits, _SVNR_WEIGHTS, strict=True)) % 11
    if check == 10 or check != int(digits[3]):
        return False
    day, month = int(digits[4:6]), int(digits[6:8])
    return 1 <= day <= 31 and 1 <= month <= 15


def printed_as_svnr(date_separators: tuple[str, str], time_follows: bool) -> bool:
    return date_separators[0] == date_separators[1] and not time_follows


def mask_at_svnr(digits: str) -> str:
    return f"•••• ••••{digits[-2:]}"
