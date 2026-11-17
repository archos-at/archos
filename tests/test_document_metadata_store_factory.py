from __future__ import annotations

import pytest

from agent.knowledge import factory


@pytest.fixture(autouse=True)
def _reset_summary_store(monkeypatch):
    monkeypatch.setattr(factory, "_document_metadata_store", None)
    for var in ("SUMMARY_DB", "NAT_JOB_STORE_DB_URL"):
        monkeypatch.delenv(var, raising=False)
    yield
    factory._document_metadata_store = None


def test_lazy_init_prefers_summary_db(monkeypatch, tmp_path):
    url = f"sqlite+aiosqlite:///{tmp_path / 'summary.db'}"
    monkeypatch.setenv("SUMMARY_DB", url)
    monkeypatch.setenv("NAT_JOB_STORE_DB_URL", f"sqlite+aiosqlite:///{tmp_path / 'nat.db'}")

    store = factory._get_document_metadata_store()

    assert store.db_url == url


def test_lazy_init_falls_back_to_nat_job_store(monkeypatch, tmp_path):
    url = f"sqlite+aiosqlite:///{tmp_path / 'nat.db'}"
    monkeypatch.setenv("NAT_JOB_STORE_DB_URL", url)

    store = factory._get_document_metadata_store()

    assert store.db_url == url


def test_lazy_init_uses_default_only_when_no_env(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)

    store = factory._get_document_metadata_store()

    assert store.db_url == factory._DEFAULT_METADATA_DB


def test_configure_summary_db_is_not_overridden_by_env(monkeypatch, tmp_path):
    monkeypatch.setenv("SUMMARY_DB", f"sqlite+aiosqlite:///{tmp_path / 'env.db'}")
    configured = f"sqlite+aiosqlite:///{tmp_path / 'configured.db'}"

    factory.configure_summary_db(configured)
    store = factory._get_document_metadata_store()

    assert store.db_url == configured
