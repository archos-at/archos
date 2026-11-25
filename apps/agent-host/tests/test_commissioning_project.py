from __future__ import annotations

from agent_host.jobs.access import derive_project_collection


def test_picks_the_project_collection_out_of_a_full_scope() -> None:
    assert derive_project_collection(["base_corpus", "s_conv-1", "proj_abc"]) == "proj_abc"


def test_a_conversation_scoped_collection_is_not_a_project() -> None:
    assert derive_project_collection(["base_corpus", "s_conv-1"]) is None


def test_the_base_corpus_alone_is_not_a_project() -> None:
    assert derive_project_collection(["base_corpus"]) is None


def test_the_office_archive_is_not_a_project() -> None:
    assert derive_project_collection(["base_corpus", "archiv_org1", "proj_abc", "s_conv-1"]) == "proj_abc"
    assert derive_project_collection(["base_corpus", "archiv_org1", "s_conv-1"]) is None


def test_an_ambiguous_scope_is_refused_rather_than_guessed() -> None:
    assert derive_project_collection(["base_corpus", "proj_abc", "proj_xyz"]) is None


def test_no_scope_at_all() -> None:
    assert derive_project_collection(None) is None
    assert derive_project_collection([]) is None


def test_a_job_queued_under_the_old_base_corpus_name_is_not_a_project() -> None:
    assert derive_project_collection(["oib_knowledge", "proj_abc"]) == "proj_abc"


_RESTRICTED = "proj_abc_r0123456789ab"


def test_a_restricted_folder_collection_is_its_project_not_a_second_one() -> None:
    scope = ["base_corpus", "archiv_org1", "proj_abc", _RESTRICTED, "s_conv-1"]
    assert derive_project_collection(scope) == "proj_abc"


def test_a_restricted_collection_alone_records_its_base_project() -> None:
    assert derive_project_collection(["base_corpus", _RESTRICTED]) == "proj_abc"


def test_two_projects_stay_ambiguous_with_a_restricted_collection_in_scope() -> None:
    assert derive_project_collection(["base_corpus", "proj_xyz", _RESTRICTED]) is None


def test_only_the_exact_restricted_suffix_is_read_as_one() -> None:
    assert derive_project_collection(["base_corpus", "proj_abc", "proj_abc_r0123456789a"]) is None
    assert derive_project_collection(["base_corpus", "proj_abc", "proj_abc_r0123456789ag"]) is None
