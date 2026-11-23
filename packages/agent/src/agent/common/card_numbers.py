from __future__ import annotations

from collections.abc import Callable
from collections.abc import Iterator

_CARD_PREFIXES = ((2200, 2204), (2221, 2720), (3000, 3099), (3400, 3999), (4000, 6999))
_NETWORK_SPLITS: dict[tuple[int, ...], tuple[str, ...]] = {
    (4, 6, 5): ("34", "37"),
    (4, 6, 4): ("30", "36", "38", "39"),
}
CARD_MAX_GROUPS = 5

CARD_CONTEXT_WORDS: tuple[str, ...] = (
    "karte",
    "kreditkart",
    "debitkart",
    "bankomatkart",
    "bankkart",
    "card",
    "credit",
    "visa",
    "mastercard",
    "maestro",
    "amex",
    "american express",
    "diners",
    "jcb",
    "unionpay",
    "cvc",
    "cvv",
)
CARD_CONTEXT_REACH = 48
CARD_PAGE_LABELS: tuple[str, ...] = ("kartennummer", "kartennr", "kreditkartennummer", "card number", "cardnumber")


def luhn_valid(digits: str) -> bool:
    total = 0
    for index, char in enumerate(reversed(digits)):
        value = int(char) * (2 if index % 2 else 1)
        total += value - 9 if value > 9 else value
    return total % 10 == 0


def valid_card(digits: str) -> bool:
    if not 13 <= len(digits) <= 19 or not luhn_valid(digits):
        return False
    prefix = int(digits[:4])
    return any(low <= prefix <= high for low, high in _CARD_PREFIXES)


def card_layout(sizes: tuple[int, ...]) -> bool:
    if len(sizes) == 1:
        return 13 <= sizes[0] <= 19
    if sizes in _NETWORK_SPLITS:
        return True
    return len(sizes) >= 4 and all(size == 4 for size in sizes[:-1]) and 1 <= sizes[-1] <= 4 and sum(sizes) <= 19


def wrapped_card_layout(sizes: tuple[int, ...]) -> bool:
    return sizes == (4, 4, 4, 4)


def _network_fits(sizes: tuple[int, ...], digits: str) -> bool:
    prefixes = _NETWORK_SPLITS.get(sizes)
    return prefixes is None or digits[:2] in prefixes


def _measures(groups: list[str]) -> bool:
    fours = [group for group in groups if len(group) == 4]
    return len(fours) >= 3 and all(group[-1] in "05" for group in fours)


def _stands_alone(groups: list[str], first: int, last: int) -> bool:
    before = first == 0 or len(groups[first - 1]) != 4
    after = last == len(groups) or len(groups[last]) != 4 or last == len(groups) - 1
    return before and after


def cards_in(
    groups: list[tuple[str, int, int]], layout: Callable[[tuple[int, ...]], bool] = card_layout
) -> Iterator[tuple[str, int, int, bool]]:
    digits_of = [digits for digits, _, _ in groups]
    first = 0
    while first < len(groups):
        for last in range(min(len(groups), first + CARD_MAX_GROUPS), first, -1):
            digits = "".join(digits_of[first:last])
            sizes = tuple(len(group) for group in digits_of[first:last])
            if (
                layout(sizes)
                and _network_fits(sizes, digits)
                and _stands_alone(digits_of, first, last)
                and (len(sizes) == 1 or not _measures(digits_of[first:last]))
                and valid_card(digits)
            ):
                yield digits, groups[first][1], groups[last - 1][2], len(sizes) == 1
                first = last - 1
                break
        first += 1


def context_window(text: str, start: int, end: int, is_letter: Callable[[str], bool]) -> tuple[int, int]:
    begin, stop = max(0, start - CARD_CONTEXT_REACH), min(len(text), end + CARD_CONTEXT_REACH)
    if begin > 0 and is_letter(text[begin - 1]):
        while begin < start and is_letter(text[begin]):
            begin += 1
    while stop < len(text) and is_letter(text[stop]):
        stop += 1
    return begin, stop


def has_word(folded: str, words: tuple[str, ...], is_letter: Callable[[str], bool]) -> bool:
    for word in words:
        at = folded.find(word)
        while at != -1:
            if at == 0 or not is_letter(folded[at - 1]):
                return True
            at = folded.find(word, at + 1)
    return False


def mask_card(digits: str) -> str:
    return f"•••• {digits[-4:]}"
