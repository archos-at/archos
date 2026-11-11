"""The dirty set: ancestors in one mark, the debounce, deepest first, what a build leaves behind, the budget."""

from __future__ import annotations

import os

import pytest

from agent.knowledge.folder_cards import queue

T0 = 1_800_000_000.0


def test_the_postgres_branch_ran_where_it_is_required():
    """CI's ``task be:test:postgres`` sets the guard: there a missing database fails instead of skipping green."""
    if os.environ.get("TEST_POSTGRES_REQUIRED"):
        assert os.environ.get("TEST_POSTGRES_URL"), "TEST_POSTGRES_URL is unset while REQUIRED is set"


@pytest.fixture
def url(database_url):
    return database_url


def _paths(url, collection="proj"):
    return [path for path, _dirty, _marked in queue.queued(collection, url=url)]


class TestMark:
    def test_a_folder_marks_itself_and_every_folder_above_it(self, url):
        assert queue.mark("proj", ["Gutachten/Brandschutz/2026"], "org_1", now=T0, url=url) == 3

        assert _paths(url) == ["Gutachten", "Gutachten/Brandschutz", "Gutachten/Brandschutz/2026"]

    def test_the_root_is_no_folder(self, url):
        assert queue.mark("proj", ["", "/"], now=T0, url=url) == 0
        assert _paths(url) == []

    def test_a_second_mark_moves_the_quiet_clock_and_keeps_the_dirty_clock(self, url):
        queue.mark("proj", ["A"], now=T0, url=url)
        queue.mark("proj", ["A"], now=T0 + 120, url=url)

        assert queue.queued("proj", url=url) == [("A", T0, T0 + 120)]

    def test_an_organization_once_known_is_not_forgotten_by_a_mark_that_does_not_know_it(self, url):
        queue.mark("proj", ["A"], "org_1", now=T0, url=url)
        queue.mark("proj", ["A"], None, now=T0 + 1, url=url)

        (folder,) = queue.due(now=T0 + queue.QUIET_SECONDS + 10, url=url)
        assert folder.organization_id == "org_1"


def _due(url, now, collection=None):
    return [folder.folder_path for folder in queue.due(collection, now=now, url=url)]


class TestDue:
    def test_nothing_is_due_before_the_folder_went_quiet(self, url):
        queue.mark("proj", ["A"], now=T0, url=url)

        assert _due(url, T0 + queue.QUIET_SECONDS - 1) == []
        assert _due(url, T0 + queue.QUIET_SECONDS) == ["A"]

    def test_a_folder_that_never_goes_quiet_is_due_after_the_hard_cap(self, url):
        for minute in range(0, 61, 5):
            queue.mark("proj", ["A"], now=T0 + minute * 60, url=url)

        assert _due(url, T0 + queue.MAX_DIRTY_SECONDS) == ["A"]

    def test_deepest_first_and_never_a_parent_while_a_child_is_dirty(self, url):
        queue.mark("proj", ["A/B/C", "D"], now=T0, url=url)

        assert _due(url, T0 + queue.QUIET_SECONDS + 1) == ["A/B/C", "D"]

    def test_the_parent_follows_once_its_child_is_built(self, url):
        queue.mark("proj", ["A/B"], now=T0, url=url)
        later = T0 + queue.QUIET_SECONDS + 1

        queue.finish("proj", "A/B", later, url=url)

        assert _due(url, later + 1) == ["A"]

    def test_one_collection_is_asked_for_its_own_folders(self, url):
        queue.mark("proj", ["A"], now=T0, url=url)
        queue.mark("other", ["B"], now=T0, url=url)
        later = T0 + queue.QUIET_SECONDS + 1

        assert _due(url, later, "other") == ["B"]
        assert sorted(folder.collection for folder in queue.due(now=later, url=url)) == ["other", "proj"]

    def test_reading_what_is_due_takes_nothing_however_long_the_build_runs(self, url):
        """No claim, so nothing to go stale: a folder is due until its build says it is built.

        The claim queue handed a folder out again 900 s after a claim, built or not. Who
        builds is the engine's business now (one live run per collection, ``workflow``).
        """
        queue.mark("proj", ["A"], now=T0, url=url)
        later = T0 + queue.QUIET_SECONDS + 1

        assert _due(url, later) == _due(url, later + 3600) == ["A"]
        queue.finish("proj", "A", later + 3600, url=url)
        assert _due(url, later + 7200) == []

    def test_a_folder_marked_while_it_was_built_stays_dirty_with_a_new_quiet_period(self, url):
        queue.mark("proj", ["A"], now=T0, url=url)
        started = T0 + queue.QUIET_SECONDS + 1
        queue.mark("proj", ["A"], now=started + 30, url=url)

        queue.finish("proj", "A", started, url=url)

        assert queue.queued("proj", url=url) == [("A", started + 30, started + 30)]

    def test_a_folder_given_up_leaves_whatever_marked_it(self, url):
        queue.mark("proj", ["A/B"], now=T0, url=url)

        assert queue.drop("proj", "A/B", url=url) == 1
        assert _paths(url) == ["A"]
        assert queue.drop("proj", url=url) == 1
        assert _paths(url) == []

    def test_a_deferred_collection_waits_out_a_quiet_period_again(self, url):
        queue.mark("proj", ["A"], now=T0, url=url)
        queue.mark("other", ["B"], now=T0, url=url)
        failed_at = T0 + queue.MAX_DIRTY_SECONDS + 5

        assert queue.defer("proj", now=failed_at, url=url) == (1, 0)

        assert _due(url, failed_at + 1) == ["B"]
        assert _due(url, failed_at + queue.QUIET_SECONDS, "proj") == ["A"]

    def test_a_folder_deferred_round_after_round_is_dropped_and_a_newer_mark_is_not(self, url):
        queue.mark("proj", ["A"], now=T0, url=url)
        for _round in range(queue.GIVE_UP_ROUNDS - 1):
            assert queue.defer("proj", now=T0, url=url) == (1, 0)
        queue.mark("proj", ["B"], now=T0, url=url)

        assert queue.defer("proj", now=T0, url=url) == (1, 1)

        assert _paths(url) == ["B"]

    def test_a_folder_marked_again_keeps_its_count_and_a_passed_build_clears_it(self, url):
        queue.mark("proj", ["A"], now=T0, url=url)
        for _round in range(queue.GIVE_UP_ROUNDS - 1):
            queue.defer("proj", now=T0, url=url)
        queue.mark("proj", ["A"], now=T0 + 30, url=url)  # marked while its build ran: the row stays
        queue.finish("proj", "A", T0, url=url)

        assert queue.defer("proj", now=T0, url=url) == (1, 0)

    def test_a_table_of_the_release_before_still_takes_marks(self, url):
        """It has the claim loop's ``claimed_at``, which nothing writes or reads any more."""
        from sqlalchemy import text

        with queue._engine(url).begin() as conn:
            conn.execute(text("ALTER TABLE folder_card_queue ADD COLUMN claimed_at FLOAT"))

        assert queue.mark("proj", ["A"], now=T0, url=url) == 1
        assert queue.defer("proj", now=T0, url=url) == (1, 0)


class TestBudget:
    def test_tokens_add_up_per_organization_and_month(self, url):
        queue.add_tokens("org_1", 1000, now=T0, url=url)
        queue.add_tokens("org_1", 500, now=T0 + 60, url=url)
        queue.add_tokens("org_2", 7, now=T0, url=url)

        assert queue.tokens_used("org_1", now=T0, url=url) == 1500
        assert queue.tokens_used("org_2", now=T0, url=url) == 7
        assert queue.tokens_used("org_1", now=T0 + 40 * 86400, url=url) == 0


class TestCollections:
    def test_the_organization_of_a_collection_and_its_reconcile_clock(self, url):
        queue.remember_collection("proj", "org_1", url=url)

        assert queue.organization_of("proj", url=url) == "org_1"
        assert queue.collections_due_for_reconcile(3600, now=T0, url=url) == [("proj", "org_1")]
        queue.set_reconciled("proj", now=T0, url=url)
        assert queue.collections_due_for_reconcile(3600, now=T0 + 60, url=url) == []
