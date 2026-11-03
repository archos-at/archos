"""What makes a run of digits a payment-card number: the content screen's card rules.

Pure, and a leaf: :mod:`agent.common.content_screen` finds the runs and the
reading, and asks this module whether a stretch of digit groups is a card and
whether a card printed as one unbroken number has a card's words beside it. Its
TypeScript twin is ``apps/workspace/bff/upload-screening/card-numbers.ts``; both
are held to the shared fixture ``tests/fixtures/content_screen_cases.json``.

A card is printed in a few layouts (one unbroken number of 13-19 digits, 4-4-4-4
with a last group of 1-4, 4-6-5 for American Express, 4-6-4 for Diners), starts
in a card network's issuer range and passes Luhn.

The checksum alone is a weak gate: one number in ten passes Luhn, and the issuer
ranges cover a third of all prefixes, so about one long number in thirty looks
like a card. A number printed in a card's own groups is rare enough elsewhere for
that to hold. An UNBROKEN number is not: article and EAN codes, order, meter and
file numbers are printed that way, and a PDF's extraction glues table cells into
one. So an unbroken number is a card only with a card's word within
:data:`CARD_CONTEXT_REACH` characters of it (:data:`CARD_CONTEXT_WORDS`), the
way commercial DLP classifiers raise a bare checksum match only with a keyword
beside it. The words are matched in the folded text at a word start and may run
on (``card`` finds ``Cardnumber``, ``karte`` finds ``Kartennr.``). The 4-6-5
and 4-6-4 layouts are each one network's, so they count only in its range.
"""

from __future__ import annotations

from collections.abc import Callable
from collections.abc import Iterator

#: The card networks' issuer ranges, on a number's first four digits: Mir 2200-2204,
#: Mastercard 2221-2720, Diners 30, Amex 34/37, JCB 35, Diners 36/38/39, Visa 4,
#: Maestro and Mastercard 5, Maestro, Discover and UnionPay 6. No card begins
#: 2000-2199, the years a table prints in rows of four.
_CARD_PREFIXES = ((2200, 2204), (2221, 2720), (3000, 3099), (3400, 3999), (4000, 6999))
#: The layouts one network prints in, and the first two digits that network's numbers carry.
_NETWORK_SPLITS: dict[tuple[int, ...], tuple[str, ...]] = {
    (4, 6, 5): ("34", "37"),
    (4, 6, 4): ("30", "36", "38", "39"),
}
CARD_MAX_GROUPS = 5

#: Words that say a card is meant, folded (``content_screen.fold``): lower case,
#: umlauts spelt out. ``karte`` also finds ``Kartennummer`` and ``Kartenprüfnummer``;
#: it finds a map too, which costs little, since the number beside it must still
#: be a Luhn-valid card number in a network's range.
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
#: How many characters of the reading before and after an unbroken number are searched for a card's word.
CARD_CONTEXT_REACH = 48


def luhn_valid(digits: str) -> bool:
    """The Luhn check every payment-card number carries. Pure."""
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
    """Whether groups of these sizes are a card's layout: unbroken, 4-4-4-4 (last group 1-4), 4-6-5 or 4-6-4."""
    if len(sizes) == 1:
        return 13 <= sizes[0] <= 19
    if sizes in _NETWORK_SPLITS:
        return True
    return len(sizes) >= 4 and all(size == 4 for size in sizes[:-1]) and 1 <= sizes[-1] <= 4 and sum(sizes) <= 19


def wrapped_card_layout(sizes: tuple[int, ...]) -> bool:
    """A card wrapped at a line end counts in one layout only, four groups of four: table rows are not cards."""
    return sizes == (4, 4, 4, 4)


def _network_fits(sizes: tuple[int, ...], digits: str) -> bool:
    """Whether a network's own layout carries that network's digits (4-6-5 is Amex, 4-6-4 Diners)."""
    prefixes = _NETWORK_SPLITS.get(sizes)
    return prefixes is None or digits[:2] in prefixes


def _stands_alone(groups: list[str], first: int, last: int) -> bool:
    """Whether the groups ``first`` to ``last`` are not cut out of a longer number printed in fours."""
    before = first == 0 or len(groups[first - 1]) != 4
    after = last == len(groups) or len(groups[last]) != 4 or last == len(groups) - 1
    return before and after


def cards_in(
    groups: list[tuple[str, int, int]], layout: Callable[[tuple[int, ...]], bool] = card_layout
) -> Iterator[tuple[str, int, int, bool]]:
    """Each card among a run's digit groups: its digits, its start and end in the run, and whether it is unbroken.

    A card is some consecutive groups that have a card's layout and pass its
    checksum; the leftmost start wins and takes the longest such stretch. What
    stands before it (a position) or after it (an expiry, a security code) is
    not part of it. A group of four digits beside it is, though: it makes the
    card a piece of a longer number printed in fours, which is judged as a
    whole, so a table of years gets no sliding window. The last group may be
    four digits long: it is the security code.
    """
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
                and valid_card(digits)
            ):
                yield digits, groups[first][1], groups[last - 1][2], len(sizes) == 1
                first = last - 1
                break
        first += 1


def has_card_word(folded: str, is_letter: Callable[[str], bool]) -> bool:
    """Whether a card's word (:data:`CARD_CONTEXT_WORDS`) starts a word somewhere in ``folded``. Pure.

    ``folded`` begins at a word start. ``is_letter`` is the screen's own
    letter test, so a word inside another (``Ricardo``) does not count.
    """
    for word in CARD_CONTEXT_WORDS:
        at = folded.find(word)
        while at != -1:
            if at == 0 or not is_letter(folded[at - 1]):
                return True
            at = folded.find(word, at + 1)
    return False


def mask_card(digits: str) -> str:
    return f"•••• {digits[-4:]}"
