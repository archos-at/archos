from __future__ import annotations

import contextlib
import hashlib
import logging
import os
import tempfile
import threading
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO
from urllib.parse import quote

import httpx
from sqlalchemy import delete
from sqlalchemy import func
from sqlalchemy import select
from sqlalchemy import update
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects import sqlite

from agent.common import seaweed_s3
from agent.common.db_utils import ensure_schema
from agent.corpus_tables import ADDED_FILE_COLUMNS as _ADDED_FILE_COLUMNS  # noqa: F401 - a test drops them
from agent.corpus_tables import create_files as _create_files
from agent.corpus_tables import create_marks as _create_marks
from agent.corpus_tables import files as _files
from agent.corpus_tables import marks as _marks
from agent.knowledge.document_metadata_store import DocumentMetadataStore

logger = logging.getLogger(__name__)

CACHE_DIR_ENV = "BASE_CORPUS_CACHE_DIR"
DEFAULT_CACHE_DIR = "/tmp/base-corpus"

_UPLOAD_URL_PATH = "/api/internal/base-corpus/upload-url"
_DELETE_PATH = "/api/internal/base-corpus/"
_FRONTEND_INTERNAL_URL_ENV = "FRONTEND_INTERNAL_URL"
_INTERNAL_TOKEN_ENV = "INTERNAL_API_TOKEN"
_BFF_TIMEOUT_SECONDS = 15.0
_PUT_TIMEOUT_SECONDS = 300.0
_CHUNK_BYTES = 1024 * 1024

_initialized: set[str] = set()
_INIT_LOCK = threading.Lock()

_SHA_CACHE: dict[str, tuple[int, int, str]] = {}
_SHA_LOCK = threading.Lock()


class CorpusStoreError(RuntimeError): ...


class CorpusFileImmutable(CorpusStoreError):
    def __init__(self, name: str):
        super().__init__(f"the base corpus keeps other bytes as {name}; remove that file first, or use another name")
        self.file_name = name


@dataclass(frozen=True)
class FileRow:
    file_name: str
    storage_key: str
    sha256: str
    size_bytes: int
    ingested_sha256: str | None = None
    chunk_format_version: int | None = None
    failed_job_id: str | None = None
    mark_generation: int = 0
    job_mark_generation: int | None = None

    def job_carries_the_mark(self) -> bool:
        return self.job_mark_generation == self.mark_generation

    def needs_ingestion(self, chunk_format_version: int) -> bool:
        return self.ingested_sha256 != self.sha256 or self.chunk_format_version != chunk_format_version


def cache_dir() -> Path:
    return Path(os.environ.get(CACHE_DIR_ENV, "").strip() or DEFAULT_CACHE_DIR)


def sha256_file(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8192), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def _local_sha(path: Path) -> str | None:
    try:
        stat = path.stat()
    except OSError:
        return None
    key = str(path)
    with _SHA_LOCK:
        cached = _SHA_CACHE.get(key)
    if cached is not None and cached[0] == stat.st_size and cached[1] == stat.st_mtime_ns:
        return cached[2]
    digest = sha256_file(path)
    with _SHA_LOCK:
        _SHA_CACHE[key] = (stat.st_size, stat.st_mtime_ns, digest)
    return digest


def is_valid_name(name: str) -> bool:
    return bool(name) and Path(name).name == name and name.lower().endswith(".pdf")


def _require_name(name: str) -> None:
    if not is_valid_name(name):
        raise CorpusStoreError(f"not a corpus file name: {name!r}")


def _db_url() -> str:
    url = os.environ.get("SUMMARY_DB") or os.environ.get("NAT_JOB_STORE_DB_URL")
    if not url:
        raise CorpusStoreError("the base corpus needs SUMMARY_DB (the shared knowledge database)")
    return url


def _ensure_table(url: str) -> None:
    with _INIT_LOCK:
        if url in _initialized:
            return
        engine = DocumentMetadataStore._get_or_create_sync_engine(url)
        ensure_schema(engine, _files.name, _create_files)
        ensure_schema(engine, _marks.name, _create_marks)
        _initialized.add(url)


@contextlib.contextmanager
def _transaction():
    url = _db_url()
    _ensure_table(url)
    with DocumentMetadataStore._get_or_create_sync_engine(url).begin() as conn:
        yield conn


def _row_from(record) -> FileRow:
    return FileRow(
        file_name=record.file_name,
        storage_key=record.storage_key,
        sha256=record.sha256,
        size_bytes=int(record.size_bytes),
        ingested_sha256=record.ingested_sha256,
        chunk_format_version=None if record.chunk_format_version is None else int(record.chunk_format_version),
        failed_job_id=record.failed_job_id,
        mark_generation=int(record.mark_generation),
        job_mark_generation=None if record.job_mark_generation is None else int(record.job_mark_generation),
    )


def list_files() -> dict[str, FileRow]:
    with _transaction() as conn:
        return {record.file_name: _row_from(record) for record in conn.execute(select(_files))}


def get_file(name: str) -> FileRow | None:
    with _transaction() as conn:
        record = conn.execute(select(_files).where(_files.c.file_name == name)).first()
    return _row_from(record) if record is not None else None


def _upsert_file(row: FileRow) -> None:
    values = {"storage_key": row.storage_key, "sha256": row.sha256, "size_bytes": row.size_bytes}
    with _transaction() as conn:
        insert = postgresql.insert if conn.dialect.name == "postgresql" else sqlite.insert
        conn.execute(
            insert(_files)
            .values(file_name=row.file_name, **values)
            .on_conflict_do_update(index_elements=[_files.c.file_name], set_={**values, "uploaded_at": func.now()})
        )


def _delete_file_row(name: str) -> None:
    with _transaction() as conn:
        conn.execute(delete(_files).where(_files.c.file_name == name))
        conn.execute(delete(_marks).where(_marks.c.file_name == name))


@dataclass(frozen=True)
class FileMark:
    country_id: str | None = None
    edition_id: str | None = None
    released: bool | None = None

    @classmethod
    def of(cls, record) -> FileMark:
        return cls(country_id=record.country_id, edition_id=record.edition_id, released=record.released)

    def job_config(self) -> dict[str, str | bool]:
        fields = {"country_id": self.country_id, "knowledge_edition_id": self.edition_id}
        config: dict[str, str | bool] = {key: value for key, value in fields.items() if value}
        if self.released is not None:
            config["released"] = self.released
        return config


def set_mark(name: str, mark: FileMark) -> None:
    _require_name(name)
    values = {"country_id": mark.country_id, "edition_id": mark.edition_id, "released": mark.released}
    with _transaction() as conn:
        insert = postgresql.insert if conn.dialect.name == "postgresql" else sqlite.insert
        conn.execute(
            insert(_marks)
            .values(file_name=name, **values)
            .on_conflict_do_update(index_elements=[_marks.c.file_name], set_={**values, "marked_at": func.now()})
        )
        conn.execute(
            update(_files).where(_files.c.file_name == name).values(mark_generation=_files.c.mark_generation + 1)
        )


def begin_job(name: str) -> FileMark | None:
    with _transaction() as conn:
        conn.execute(
            update(_files).where(_files.c.file_name == name).values(job_mark_generation=_files.c.mark_generation)
        )
        record = conn.execute(select(_marks).where(_marks.c.file_name == name)).first()
    return FileMark.of(record) if record is not None else None


LEGACY_CORPUS_COUNTRY = "AT"
_BACKFILL_DONE = "__legacy_country_backfill_done__"


def legacy_unmarked() -> list[str]:
    with _transaction() as conn:
        if conn.execute(select(_marks.c.file_name).where(_marks.c.file_name == _BACKFILL_DONE)).first():
            return []
        rows = conn.execute(
            select(_files.c.file_name)
            .outerjoin(_marks, _marks.c.file_name == _files.c.file_name)
            .where(_marks.c.file_name.is_(None))
        )
        return sorted(row.file_name for row in rows)


def record_legacy_backfill() -> None:
    with _transaction() as conn:
        insert = postgresql.insert if conn.dialect.name == "postgresql" else sqlite.insert
        conn.execute(
            insert(_marks).values(file_name=_BACKFILL_DONE).on_conflict_do_nothing(index_elements=[_marks.c.file_name])
        )


def get_mark(name: str) -> FileMark | None:
    with _transaction() as conn:
        record = conn.execute(select(_marks).where(_marks.c.file_name == name)).first()
    return FileMark.of(record) if record is not None else None


def released_to(name: str, countries: Iterable[str]) -> bool:
    mark = get_mark(name)
    return mark is not None and mark.released is not False and mark.country_id in set(countries)


def list_marks() -> dict[str, FileMark]:
    with _transaction() as conn:
        return {record.file_name: FileMark.of(record) for record in conn.execute(select(_marks))}


def mark_ingested(name: str, sha256: str, chunk_format_version: int) -> bool:
    with _transaction() as conn:
        result = conn.execute(
            update(_files)
            .where(
                _files.c.file_name == name,
                _files.c.sha256 == sha256,
                _files.c.job_mark_generation == _files.c.mark_generation,
            )
            .values(ingested_sha256=sha256, chunk_format_version=chunk_format_version, failed_job_id=None)
        )
    return result.rowcount == 1


def mark_failed(name: str, sha256: str, job_id: str) -> bool:
    with _transaction() as conn:
        result = conn.execute(
            update(_files).where(_files.c.file_name == name, _files.c.sha256 == sha256).values(failed_job_id=job_id)
        )
    return result.rowcount == 1


def forget_ingested(name: str | None = None) -> None:
    statement = update(_files).values(ingested_sha256=None, chunk_format_version=None, failed_job_id=None)
    if name is not None:
        statement = statement.where(_files.c.file_name == name)
    with _transaction() as conn:
        conn.execute(statement)


def _bff() -> tuple[str, dict[str, str]]:
    base_url = os.environ.get(_FRONTEND_INTERNAL_URL_ENV, "").strip()
    token = os.environ.get(_INTERNAL_TOKEN_ENV, "").strip()
    if not base_url or not token:
        raise CorpusStoreError(f"{_FRONTEND_INTERNAL_URL_ENV} and {_INTERNAL_TOKEN_ENV} are needed to write the corpus")
    return base_url.rstrip("/"), {"x-internal-token": token}


def _request_upload_url(name: str) -> tuple[str, str]:
    base_url, headers = _bff()
    try:
        response = httpx.post(
            f"{base_url}{_UPLOAD_URL_PATH}", json={"fileName": name}, headers=headers, timeout=_BFF_TIMEOUT_SECONDS
        )
        data = response.json() if response.status_code == 200 else {}
    except (httpx.HTTPError, ValueError) as e:
        raise CorpusStoreError(f"upload-url request for {name} failed: {type(e).__name__}") from e
    if response.status_code != 200:
        raise CorpusStoreError(f"upload-url request for {name} was refused (HTTP {response.status_code})")
    upload_url, storage_key = data.get("uploadUrl"), data.get("storageKey")
    if not isinstance(upload_url, str) or not upload_url or not isinstance(storage_key, str) or not storage_key:
        raise CorpusStoreError(f"upload-url answer for {name} was malformed")
    return upload_url, storage_key


def _put_object(upload_url: str, data: bytes) -> None:
    try:
        response = httpx.put(
            upload_url, content=data, headers={"Content-Type": "application/pdf"}, timeout=_PUT_TIMEOUT_SECONDS
        )
    except httpx.HTTPError as e:
        raise CorpusStoreError(f"upload to the object store failed: {type(e).__name__}") from e
    if response.status_code >= 300:
        raise CorpusStoreError(f"upload to the object store was refused (HTTP {response.status_code})")


def _delete_object(name: str) -> None:
    base_url, headers = _bff()
    try:
        response = httpx.delete(
            f"{base_url}{_DELETE_PATH}{quote(name, safe='')}", headers=headers, timeout=_BFF_TIMEOUT_SECONDS
        )
    except httpx.HTTPError as e:
        raise CorpusStoreError(f"delete of {name} from the object store failed: {type(e).__name__}") from e
    if response.status_code != 200:
        raise CorpusStoreError(f"delete of {name} from the object store was refused (HTTP {response.status_code})")


def _copy_body(body, out: BinaryIO) -> None:
    with contextlib.closing(body):
        for chunk in iter(lambda: body.read(_CHUNK_BYTES), b""):
            out.write(chunk)


def _download_object(storage_key: str, out: BinaryIO) -> None:
    try:
        client = seaweed_s3.s3_client()
        if client is None:
            raise CorpusStoreError("SeaweedFS read credentials (SEAWEED_*) are not configured")
        _copy_body(client.get_object(Bucket=seaweed_s3.default_bucket(), Key=storage_key)["Body"], out)
    except CorpusStoreError:
        raise
    except Exception as e:  # noqa: BLE001 - botocore raises many types; the caller needs one
        raise CorpusStoreError(f"download of {storage_key} failed: {type(e).__name__}") from e


@contextlib.contextmanager
def _temp_beside(target: Path):
    tmp: Path | None = None
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(dir=target.parent, prefix=".", suffix=".part")
        os.close(fd)
        tmp = Path(tmp_name)
        yield tmp
    except OSError as e:
        raise CorpusStoreError(f"could not write {target.name} into the cache: {type(e).__name__}") from e
    finally:
        if tmp is not None:
            tmp.unlink(missing_ok=True)


def _write_cache(target: Path, data: bytes) -> None:
    with _temp_beside(target) as tmp:
        tmp.write_bytes(data)
        os.replace(tmp, target)


def _fetch(row: FileRow, target: Path) -> None:
    with _temp_beside(target) as tmp:
        with tmp.open("wb") as out:
            _download_object(row.storage_key, out)
        if sha256_file(tmp) != row.sha256:
            raise CorpusStoreError(f"{row.file_name} in the object store does not match its recorded hash")
        os.replace(tmp, target)
    logger.info("Fetched base-corpus file %s into the cache (%d bytes)", row.file_name, row.size_bytes)


def ensure_local(name: str) -> Path | None:
    if not is_valid_name(name):
        return None
    target = cache_dir() / name
    row = get_file(name)
    if row is None:
        target.unlink(missing_ok=True)
        return None
    if _local_sha(target) != row.sha256:
        _fetch(row, target)
    return target


def put(name: str, data: bytes) -> FileRow:
    _require_name(name)
    upload_url, storage_key = _request_upload_url(name)
    _put_object(upload_url, data)
    row = FileRow(name, storage_key, hashlib.sha256(data).hexdigest(), len(data))
    _upsert_file(row)
    _write_cache(cache_dir() / name, data)
    return row


def remove(name: str) -> None:
    _require_name(name)
    _delete_file_row(name)
    _delete_object(name)
    (cache_dir() / name).unlink(missing_ok=True)


_KEY_PREFIX = "base-corpus/"


class CorpusObjectDownload:
    __slots__ = ("sha256", "storage_key")

    def __init__(self, storage_key: str, sha256: str) -> None:
        if not storage_key.startswith(_KEY_PREFIX) or ".." in storage_key:
            raise CorpusStoreError("not a corpus object key")
        self.storage_key = storage_key
        self.sha256 = sha256

    def __repr__(self) -> str:
        return f"<corpus object download {self.storage_key}>"

    def to_payload(self) -> dict[str, str]:
        return {"storage_key": self.storage_key, "sha256": self.sha256}

    @classmethod
    def from_payload(cls, data: dict) -> CorpusObjectDownload:
        return cls(str(data["storage_key"]), str(data["sha256"]))

    def __call__(self) -> str:
        fd, name = tempfile.mkstemp(suffix=".pdf")
        os.close(fd)
        path = Path(name)
        try:
            with path.open("wb") as out:
                _download_object(self.storage_key, out)
            if sha256_file(path) != self.sha256:
                raise CorpusStoreError(f"{self.storage_key} does not match the hash the job was made for")
        except BaseException:
            path.unlink(missing_ok=True)
            raise
        return name
