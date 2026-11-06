"""The RIS adapter, read from its source record, sends what the code sent before (ADR-0158).

``configs/sources/at/ris/source.yml`` replaced the Austrian constants of
``client.py`` and ``register.py``. The functions below are the code it replaced,
frozen verbatim, so any record edit that changes a request Austria sends (a
Bundesland parameter, the date parameter an application takes, a path segment)
fails here instead of moving the Austrian answers.
"""

from __future__ import annotations

import itertools
import re

import pytest
from ris_adapter.client import ALLOWED_DOCUMENT_HOSTS
from ris_adapter.client import CONTROLLER_FOR_APPLICATION
from ris_adapter.client import DEFAULT_BASE_URL
from ris_adapter.client import PAGE_SIZES
from ris_adapter.client import RisError
from ris_adapter.client import build_document_url
from ris_adapter.client import federal_state_param
from ris_adapter.register import _build_search_params

# --- the code before the record, frozen -------------------------------------

_FROZEN_CONTROLLERS = {
    **dict.fromkeys(["BrKons", "BgblAuth", "BgblPdf", "BgblAlt", "Begut", "RegV", "Erv"], "Bundesrecht"),
    **dict.fromkeys(["LrKons", "LgblAuth", "Lgbl", "LgblNO", "Vbl"], "Landesrecht"),
    **dict.fromkeys(
        [
            "Vfgh",
            "Vwgh",
            "Normenliste",
            "Justiz",
            "Bvwg",
            "AsylGH",
            "Lvwg",
            "Dsk",
            "Verg",
            "Dok",
            "Pvak",
            "Gbk",
            "Uvs",
            "Ubas",
            "Umse",
            "Bks",
        ],
        "Judikatur",
    ),  # fmt: skip
    "Bvb": "Bezirke",
    "Gr": "Gemeinden",
    "GrA": "Gemeinden",
    **dict.fromkeys(["PruefGewO", "Avsv", "Spg", "Avn", "KmGer", "Upts", "Mrp", "Erlaesse"], "Sonstige"),
}
_FROZEN_STATES = {
    "burgenland": "Bundesland.SucheInBurgenland",
    "kaernten": "Bundesland.SucheInKaernten",
    "niederoesterreich": "Bundesland.SucheInNiederoesterreich",
    "oberoesterreich": "Bundesland.SucheInOberoesterreich",
    "salzburg": "Bundesland.SucheInSalzburg",
    "steiermark": "Bundesland.SucheInSteiermark",
    "tirol": "Bundesland.SucheInTirol",
    "vorarlberg": "Bundesland.SucheInVorarlberg",
    "wien": "Bundesland.SucheInWien",
}
_FROZEN_JUDIKATUR = frozenset(app for app, c in _FROZEN_CONTROLLERS.items() if c == "Judikatur")
_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")


def _frozen_normalize(value: str) -> str:
    normalized = value.strip().lower().replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    return _FROZEN_STATES.get(normalized.replace(" ", "").replace("-", ""), "")


def _frozen_build(application, query, title, federal_state, date_from, date_to) -> dict[str, str]:
    params: dict[str, str] = {}
    if query:
        params["Suchworte"] = query
    if title:
        params["Titel"] = title
    if federal_state and application in ("LrKons", "Lgbl", "LgblAuth", "Vbl"):
        key = _frozen_normalize(federal_state)
        if key:
            params[key] = "true"
    for value, name in ((date_from, "date_from"), (date_to, "date_to")):
        if value and not _DATE_RE.fullmatch(value.strip()):
            raise RisError(f"{name} must use the YYYY-MM-DD format, got '{value}'")
    if application in _FROZEN_JUDIKATUR:
        if date_from:
            params["EntscheidungsdatumVon"] = date_from.strip()
        if date_to:
            params["EntscheidungsdatumBis"] = date_to.strip()
    elif application == "BgblAuth":
        if date_from:
            params["Kundmachung.Von"] = date_from.strip()
        if date_to:
            params["Kundmachung.Bis"] = date_to.strip()
    elif application == "BrKons" and date_from:
        params["Fassung.FassungVom"] = date_from.strip()
    return params


# --- parity -------------------------------------------------------------------

_STATES = ["", "Wien", "wien", "Kärnten", "Nieder-Österreich", "Niederösterreich", "Oberösterreich ", "Atlantis"]
_DATES = [("", ""), ("2020-01-01", ""), ("", "2021-12-31"), (" 2020-01-01", "2021-12-31 ")]
_TERMS = [("", ""), ("Bauordnung", ""), ("Stellplatz", "Garagengesetz")]


@pytest.mark.parametrize("application", sorted(_FROZEN_CONTROLLERS))
def test_search_terms_match_the_frozen_code_for_every_application(application):
    for state, (date_from, date_to), (query, title) in itertools.product(_STATES, _DATES, _TERMS):
        expected = _frozen_build(application, query, title, state, date_from, date_to)
        actual = _build_search_params(application, query, title, state, date_from, date_to)
        assert actual == expected, (application, state, date_from, date_to, query, title)
        assert list(actual) == list(expected), "parameter order changed (it is part of the cache key)"


def test_a_malformed_date_is_refused_with_the_same_message():
    with pytest.raises(RisError, match="date_from must use the YYYY-MM-DD format, got '01.01.2020'"):
        _build_search_params("Vwgh", "x", "", "", "01.01.2020", "")


def test_the_constants_read_from_the_record_are_the_constants_that_were_in_code():
    assert CONTROLLER_FOR_APPLICATION == _FROZEN_CONTROLLERS
    assert PAGE_SIZES == {10: "Ten", 20: "Twenty", 50: "Fifty", 100: "OneHundred"}
    assert DEFAULT_BASE_URL == "https://data.bka.gv.at/ris/api/v2.6"
    assert ALLOWED_DOCUMENT_HOSTS == frozenset({"www.ris.bka.gv.at", "ris.bka.gv.at", "data.bka.gv.at"})


@pytest.mark.parametrize(
    ("reference", "application", "url"),
    [
        ("NOR40217157", "", "https://www.ris.bka.gv.at/Dokumente/Bundesnormen/NOR40217157/NOR40217157.html"),
        ("LKT40001234", "LrKons", "https://www.ris.bka.gv.at/Dokumente/Landesnormen/LKT40001234/LKT40001234.html"),
        ("JWT_2020130074_20210415J00", "", "https://www.ris.bka.gv.at/Dokumente/Vwgh/JWT_2020130074_20210415J00/JWT_2020130074_20210415J00.html"),
        ("BVWG_W123", "", "https://www.ris.bka.gv.at/Dokumente/Bvwg/BVWG_W123/BVWG_W123.html"),
    ],
)  # fmt: skip
def test_document_urls_are_built_as_before(reference, application, url):
    assert build_document_url(reference, application) == url


def test_the_norms_route_and_the_catalog_builder_read_the_same_table():
    # They held their own copies keyed "Wien"/"Kärnten" before; the record's fold finds both spellings.
    assert federal_state_param("Kärnten") == "Bundesland.SucheInKaernten"
    assert federal_state_param("Niederösterreich") == "Bundesland.SucheInNiederoesterreich"
    assert federal_state_param("Atlantis") == ""
    assert federal_state_param("") == ""
