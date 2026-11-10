"""The German number rules of the content screen (agent.common.de_numbers).

The Steuer-ID check is held to python-stdnum's ``de.idnr``, the library this
rule would otherwise be bought from: it has no Rentenversicherungsnummer, and
the TypeScript twin needs the rule written out anyway. Where they would differ,
stdnum is right.
"""

from __future__ import annotations

import random

import pytest
from stdnum.de import idnr

from agent.common.de_numbers import valid_de_svnr
from agent.common.de_numbers import valid_de_tax_id


def test_the_tax_id_check_agrees_with_stdnum_on_random_numbers() -> None:
    draw = random.Random(20261106)
    numbers = [str(draw.randrange(10**10, 10**11)) for _ in range(50_000)]
    numbers += ["36574261809", "36574261890", "36554266806", "02476291358"]
    disagreements = [n for n in numbers if valid_de_tax_id(n) != idnr.is_valid(n)]
    assert disagreements == []


@pytest.mark.parametrize(
    ("number", "valid"),
    [
        ("15070649C103", True),  # the worked example of the German Wikipedia article
        ("15070649C104", False),  # check digit
        ("15070649c103", False),  # a capital letter
        ("01070649C103", False),  # no area 01
        ("15320649C103", False),  # no 32nd day
        ("15071349C103", False),  # no 13th month
        ("150706491103", False),  # a digit where the letter stands
    ],
)
def test_the_rentenversicherungsnummer(number: str, valid: bool) -> None:
    assert valid_de_svnr(number) is valid
