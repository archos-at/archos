"""Tests for the CountryProfile contract (agent.common.country_profile).

Covers the Austria (#1) profile's fields, the registry-file override precedence
(``with_overrides`` — data wins over code, empty overrides ignored), unknown-country
handling, the ``doctrine_for`` fail-open, and ``load_norms_file`` store-vs-YAML
precedence.
"""

from __future__ import annotations

import pytest

from agent.common import country_profile as cp
from agent.common import norm_registry as nr


@pytest.fixture(autouse=True)
def _clean_state():
    """Ensure no admin-store loader leaks between tests (and the cache is fresh)."""
    nr.reset_registry_cache()
    yield
    nr.set_db_loader(None)  # also clears the registry cache
    nr.reset_registry_cache()


def _norms_file(**overrides) -> nr.NormsFile:
    """A NormsFile with one valid entry (store loader requires non-empty entries)."""
    entry = nr.NormEntry.model_validate(
        {
            "id": "bo-wien",
            "title": "Bauordnung für Wien",
            "short": "BO Wien",
            "rank": "state_law",
            "federal_state": "Wien",
            "application": "LrKons",
            "document_number": "LWI40000225",
        }
    )
    return nr.NormsFile(entries=[entry], **overrides)


# ---------------------------------------------------------------------------
# Austria profile (#1)
# ---------------------------------------------------------------------------


class TestAustriaProfile:
    def test_at_profile_fields(self):
        profile = cp.get_country_profile("at")

        assert profile is not None
        assert profile.country == "at"
        assert profile.language == "de-AT"
        # No override in the seed → code defaults hold.
        assert profile.corpus_collection == "oib_knowledge"
        assert profile.doctrine == nr.NORM_DOCTRINE
        assert profile.corpus_note == nr.OIB_CORPUS_NOTE
        assert profile.states == nr.FEDERAL_STATE_TOKENS
        assert profile.state_probe_order == tuple(nr.BUNDESLAENDER)
        assert "Bebauungsplan" in profile.parcel_tags
        assert "Flächenwidmungsplan" in profile.parcel_tags
        # Code hooks are always the registered callables.
        assert callable(profile.applicability)
        assert callable(profile.corpus_doc_class)

    def test_no_country_has_no_profile(self):
        # DEFAULT_COUNTRY keys the store and the corpus; it is never a project's country by default.
        assert cp.DEFAULT_COUNTRY == "at"
        assert cp.get_country_profile(None) is None

    def test_country_code_is_case_insensitive(self):
        assert cp.get_country_profile("AT") is not None


# ---------------------------------------------------------------------------
# with_overrides precedence (registry data wins over code; empty ignored)
# ---------------------------------------------------------------------------


class TestWithOverrides:
    def test_nonempty_override_wins(self):
        base = cp.get_country_profile("at")
        overridden = base.with_overrides(doctrine="REGISTRY DOCTRINE")
        assert overridden.doctrine == "REGISTRY DOCTRINE"
        # Untouched fields keep their code values; the base is unmutated.
        assert overridden.corpus_note == base.corpus_note
        assert base.doctrine == nr.NORM_DOCTRINE

    def test_empty_override_ignored(self):
        base = cp.get_country_profile("at")
        same = base.with_overrides(doctrine="", corpus_note="", parcel_tags=None, states=None)
        assert same.doctrine == nr.NORM_DOCTRINE
        assert same.corpus_note == nr.OIB_CORPUS_NOTE
        assert same.parcel_tags == base.parcel_tags
        assert same.states == base.states

    def test_no_overrides_returns_same_instance(self):
        base = cp.get_country_profile("at")
        assert base.with_overrides() is base

    def test_registry_override_applied_through_get_country_profile(self):
        # A stored NormsFile carrying a doctrine override wins over the code constant.
        nr.set_db_loader(lambda: _norms_file(doctrine="STORED DOCTRINE", language="de-XX"))
        profile = cp.get_country_profile("at")
        assert profile.doctrine == "STORED DOCTRINE"
        assert profile.language == "de-XX"

    def test_empty_registry_fields_keep_code_defaults(self):
        # Stored NormsFile with empty override fields → code defaults survive.
        nr.set_db_loader(lambda: _norms_file())
        profile = cp.get_country_profile("at")
        assert profile.doctrine == nr.NORM_DOCTRINE
        assert profile.corpus_note == nr.OIB_CORPUS_NOTE


# ---------------------------------------------------------------------------
# Unknown country
# ---------------------------------------------------------------------------


class TestUnknownCountry:
    def test_unknown_country_returns_none(self):
        assert cp.get_country_profile("zz") is None

    def test_register_and_lookup(self):
        # The registry is a plain dict; a second country registers the same way.
        assert cp.get_country_profile("qq") is None


# ---------------------------------------------------------------------------
# doctrine_for fail-open
# ---------------------------------------------------------------------------


class TestDoctrineFor:
    def test_unknown_country_falls_back_to_norm_doctrine(self):
        assert nr.doctrine_for("country=zz Bauvorhaben") == nr.NORM_DOCTRINE

    def test_default_country_uses_profile_doctrine(self):
        nr.set_db_loader(lambda: _norms_file(doctrine="PROFILE DOCTRINE"))
        assert nr.doctrine_for(None) == "PROFILE DOCTRINE"

    def test_none_context_defaults_to_austria(self):
        assert nr.doctrine_for(None) == nr.NORM_DOCTRINE


# ---------------------------------------------------------------------------
# load_norms_file: store precedence, YAML fallback
# ---------------------------------------------------------------------------


class TestLoadNormsFile:
    def test_store_precedence_for_default_country(self):
        stored = _norms_file(doctrine="from store")
        nr.set_db_loader(lambda: stored)
        assert nr.load_norms_file("at") is stored

    def test_empty_store_falls_back_to_yaml(self):
        # An empty store (no entries) must not shadow the YAML seed.
        nr.set_db_loader(lambda: nr.NormsFile(entries=[]))
        loaded = nr.load_norms_file("at")
        assert loaded is not None
        assert loaded.corpus_collection == "oib_knowledge"

    def test_yaml_fallback_without_store(self):
        nr.set_db_loader(None)
        nr.reset_registry_cache()
        loaded = nr.load_norms_file("at")
        assert loaded is not None
        assert loaded.corpus_collection == "oib_knowledge"

    def test_unknown_country_yaml_missing_returns_none(self):
        nr.set_db_loader(None)
        assert nr.load_norms_file("zz") is None


# ---------------------------------------------------------------------------
# Where the project is: resolve_site, and what each consumer makes of it
# ---------------------------------------------------------------------------


def _profile(confirmed: str = "", assumptions: str = "") -> str:
    text = "PROJECT_CONTEXT v1\n"
    if confirmed:
        text += f"\nconfirmed:\n{confirmed}\n"
    if assumptions:
        text += f"\nassumptions:\n{assumptions}\n"
    return text


class TestResolveSite:
    @pytest.mark.parametrize(
        ("profile", "country", "state", "confirmed"),
        [
            (_profile("- country=at\n- federal_state=tyrol"), "at", "tyrol", True),
            (_profile("- federal_state=vienna"), "at", "vienna", True),
            (_profile("- country=de"), "de", None, True),
            (_profile("- country=ch"), "ch", None, True),
            # `other` never matched the old `country=[a-z]{2}\b` and fell through to Austria.
            (_profile("- country=other"), "other", None, True),
            (_profile("- federal_state=outside_austria"), "other", None, True),
            (_profile(assumptions="- federal_state=vienna [Vorschlag: Plan.pdf, S. 1]"), "at", "vienna", False),
            (_profile("- country=de", "- federal_state=vienna"), "de", None, True),
            # A legacy German key from an older pod.
            (_profile("- bundesland=wien"), "at", "vienna", True),
            (_profile("- main_use=residential"), None, None, False),
        ],
    )
    def test_the_profile_places_the_project(self, profile, country, state, confirmed):
        site = cp.resolve_site(profile)
        assert (site.country, site.federal_state) == (country, state)
        if country is not None:
            assert site.confirmed is confirmed

    def test_nothing_places_a_project_by_default(self):
        """Defect 1: an unplaced project resolved to Austria."""
        assert cp.resolve_site(None) == cp.SITE_UNKNOWN
        assert nr.resolve_country(None) is None
        assert nr.resolve_country("country=other") is None  # free text is not a profile line

    def test_memory_lines_do_not_place_a_project(self):
        composed = _profile("- main_use=residential") + "\nPROJECT_MEMORY v1\n- country=de\n"
        assert cp.resolve_site(composed).country is None


class TestSiteNote:
    def test_an_austrian_project_reads_nothing_new(self):
        assert cp.site_note(_profile("- federal_state=vienna")) is None
        assert cp.site_note(None) is None

    @pytest.mark.parametrize(("line", "name"), [("- country=de", "Germany"), ("- country=ch", "Switzerland")])
    def test_a_project_abroad_is_told_what_is_not_covered(self, line, name):
        note = cp.site_note(_profile(line))
        assert note is not None
        assert f"Jurisdiction: {name}, not covered" in note
        assert "No Austrian law, OIB-Richtlinie" in note

    def test_an_unplaced_project_is_told_the_site_is_missing(self):
        note = cp.site_note(_profile("- main_use=residential"))
        assert note is not None
        assert "site not stated" in note


class TestDoctrineAbroad:
    @pytest.mark.parametrize("line", ["- country=de", "- country=ch", "- country=other"])
    def test_no_austrian_doctrine_for_a_project_abroad(self, line):
        doctrine = nr.doctrine_for(_profile(line))
        assert doctrine != nr.NORM_DOCTRINE
        assert "not covered" in doctrine

    def test_an_austrian_project_keeps_the_doctrine(self):
        assert nr.doctrine_for(_profile("- federal_state=tyrol")) == nr.NORM_DOCTRINE

    def test_no_austrian_catalogue_for_a_project_abroad(self):
        assert nr.render_block_for_prompt(_profile("- country=de\n- main_use=residential")) is None

    def test_the_doctrine_names_no_viennese_portal_for_every_land(self):
        assert "(in Wien:\nwien.gv.at/flaechenwidmung/public)" in nr.NORM_DOCTRINE
