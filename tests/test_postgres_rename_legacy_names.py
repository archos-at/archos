from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path
from urllib.parse import urlparse

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "deploy" / "postgres" / "rename-legacy-names.sh"
_URL = os.environ.get("TEST_POSTGRES_URL")

pytestmark = pytest.mark.skipif(not _URL or not shutil.which("psql"), reason="TEST_POSTGRES_URL or psql not available")

DATABASES = ("jobs", "checkpoints", "app")
RLS_ROLES = {
    "grid_app_owner": "app_owner",
    "grid_app_platform": "app_platform",
    "grid_app_rw": "app_rw",
    "grid_keda_scaler": "keda_scaler",
}
ROLES = ("agent", *RLS_ROLES, *RLS_ROLES.values())
RLS_PASSWORDS = {
    "RUNTIME_PASSWORD": "rw-test-password",
    "SCALER_PASSWORD": "scaler-test-password",
}  # pragma: allowlist secret


def _env(user: str) -> dict[str, str]:
    url = urlparse(_URL or "")
    return {
        **os.environ,
        "PGHOST": url.hostname or "127.0.0.1",
        "PGPORT": str(url.port or 5432),
        "PGUSER": user,
        "PGPASSWORD": url.password or "unused",
    }


def _superuser() -> str:
    return urlparse(_URL or "").username or "postgres"


def _psql(sql: str, user: str | None = None, database: str = "postgres") -> str:
    result = subprocess.run(
        ["psql", "-X", "-v", "ON_ERROR_STOP=1", "-tAq", "-d", database, "-c", sql],
        env=_env(user or _superuser()),
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.strip()


def _run_script(user: str, *args: str, **extra: str) -> subprocess.CompletedProcess[str]:
    env = {**_env(user), "ROLE_PASSWORD": "test-password", **extra}  # pragma: allowlist secret (throwaway cluster)
    return subprocess.run(["sh", str(SCRIPT), *args], env=env, capture_output=True, text=True, timeout=120, check=False)


def _login(role: str, password: str, sql: str, database: str = "postgres") -> str:
    url = urlparse(_URL or "")
    env = {**_env(role), "PGPASSWORD": password, "PGHOST": url.hostname or "127.0.0.1"}
    result = subprocess.run(
        ["psql", "-X", "-v", "ON_ERROR_STOP=1", "-tAq", "-h", url.hostname or "127.0.0.1", "-d", database, "-c", sql],
        env=env,
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.strip()


def _databases() -> set[str]:
    return set(_psql("SELECT datname FROM pg_database").split())


def _roles() -> set[str]:
    return set(_psql("SELECT rolname FROM pg_roles").split())


@pytest.fixture(autouse=True)
def _clean_cluster():
    def clean():
        for name in DATABASES:
            _psql(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)")
        for role in ROLES:
            _psql(f"DROP ROLE IF EXISTS {role}")

    clean()
    yield
    clean()


def _install(*, superuser: bool) -> None:
    attributes = "SUPERUSER LOGIN" if superuser else "LOGIN"
    _psql(f"CREATE ROLE agent {attributes} PASSWORD 'agent-test-password'")  # pragma: allowlist secret
    for name in DATABASES:
        _psql(f"CREATE DATABASE {name} OWNER agent")


def test_an_install_with_no_old_name_is_left_alone_and_a_second_run_is_a_no_op():
    _install(superuser=False)

    for _ in range(2):
        result = _run_script(_superuser())
        assert result.returncode == 0, result.stderr
        assert "->" not in result.stdout
        assert set(DATABASES) <= _databases() and "agent" in _roles()


def test_a_fresh_install_migrates_under_the_old_role_names_and_renames_them_after():
    _install(superuser=False)

    before = _run_script(_superuser(), ENSURE_RLS_ROLES="1", **RLS_PASSWORDS)
    assert before.returncode == 0, before.stderr
    assert {"grid_app_owner", "grid_app_platform", "grid_app_rw", "grid_keda_scaler"} <= _roles()
    assert not set(RLS_ROLES.values()) & _roles()
    _psql("CREATE TABLE notes (id int)", database="app")
    _psql("GRANT SELECT ON notes TO grid_app_rw", database="app")

    after = _run_script(_superuser(), "after-migrate", **RLS_PASSWORDS)

    assert after.returncode == 0, after.stderr
    assert "role grid_app_rw -> app_rw" in after.stdout
    assert set(RLS_ROLES.values()) <= _roles() and not set(RLS_ROLES) & _roles()
    assert _login("app_rw", RLS_PASSWORDS["RUNTIME_PASSWORD"], "SELECT count(*) FROM notes", database="app") == "0"
    assert (
        _login("app_rw", RLS_PASSWORDS["RUNTIME_PASSWORD"], "SET ROLE app_platform; SELECT current_user")
        == "app_platform"
    )
    assert _login("keda_scaler", RLS_PASSWORDS["SCALER_PASSWORD"], "SELECT current_user") == "keda_scaler"
    assert _psql("SELECT rolbypassrls::text || rolinherit::text FROM pg_roles WHERE rolname = 'app_rw'") == "falsefalse"

    again = _run_script(_superuser(), "after-migrate", **RLS_PASSWORDS)
    assert again.returncode == 0, again.stderr
    assert "->" not in again.stdout
    rerun = _run_script(_superuser(), ENSURE_RLS_ROLES="1", **RLS_PASSWORDS)
    assert rerun.returncode == 0, rerun.stderr
    assert "created" not in rerun.stdout and not set(RLS_ROLES) & _roles()


def test_compose_renames_the_roles_init_db_created_without_a_scaler():
    _install(superuser=True)
    _psql("CREATE ROLE grid_app_platform NOLOGIN BYPASSRLS")
    _psql("CREATE ROLE grid_app_rw LOGIN NOINHERIT")
    _psql("GRANT grid_app_platform TO grid_app_rw")
    assert _run_script("agent").returncode == 0

    after = _run_script("agent", "after-migrate")

    assert after.returncode == 0, after.stderr
    assert {"app_platform", "app_rw"} <= _roles() and not {"grid_app_platform", "grid_app_rw", "keda_scaler"} & _roles()
    assert _psql("SELECT pg_has_role('app_rw', 'app_platform', 'MEMBER')::text") == "true"
