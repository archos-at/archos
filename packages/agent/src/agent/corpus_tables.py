"""The base corpus's two tables in the knowledge database, and how the file table gets a column added later.

``agent.corpus_store`` reads and writes them and documents what each column means; this module
only says what the tables are. Both are created on first use, under the schema lock.
"""

from __future__ import annotations

from sqlalchemy import BigInteger
from sqlalchemy import Column
from sqlalchemy import DateTime
from sqlalchemy import Integer
from sqlalchemy import MetaData
from sqlalchemy import Table
from sqlalchemy import Text
from sqlalchemy import func
from sqlalchemy import text
from sqlalchemy.schema import CreateTable

from agent.common.db_utils import present_columns

_METADATA = MetaData()
files = Table(
    "oib_corpus_files",
    _METADATA,
    Column("file_name", Text, primary_key=True),
    Column("storage_key", Text, nullable=False),
    Column("sha256", Text, nullable=False),
    Column("size_bytes", BigInteger, nullable=False),
    Column("uploaded_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Column("ingested_sha256", Text, nullable=True),
    Column("chunk_format_version", Integer, nullable=True),
    Column("failed_job_id", Text, nullable=True),
    Column("mark_generation", Integer, nullable=False, server_default="0"),
    Column("job_mark_generation", Integer, nullable=True),
)

#: Columns a table created before them lacks, added on first use: name to its DDL type, the same in both dialects.
ADDED_FILE_COLUMNS = {"mark_generation": "INTEGER NOT NULL DEFAULT 0", "job_mark_generation": "INTEGER"}

#: The platform record a corpus file is the text of (ADR-0173): its country's pack and its edition.
#: Its own table, so the file table's shape stays what every replica created; set by the platform's
#: indexing job, read into every ingest job of the file, so a re-ingest keeps them on the chunks.
marks = Table(
    "oib_corpus_marks",
    _METADATA,
    Column("file_name", Text, primary_key=True),
    Column("country_id", Text, nullable=True),
    Column("edition_id", Text, nullable=True),
    Column("marked_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
)


def create_files(conn) -> None:
    """The file table, and the columns one created before them lacks (additive; old replicas ignore them)."""
    conn.execute(CreateTable(files, if_not_exists=True))
    # Looked up first: ADD COLUMN takes the table's exclusive lock even for a column that exists (`present_columns`).
    present = present_columns(conn, files.name)
    for name, column_type in ADDED_FILE_COLUMNS.items():
        if name not in present:
            # Both come from the module constant above; no user input.
            # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
            conn.execute(text(f"ALTER TABLE {files.name} ADD COLUMN {name} {column_type}"))
