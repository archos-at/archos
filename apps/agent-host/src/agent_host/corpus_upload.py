"""What a base-corpus upload holds: one PDF, or the PDFs of a ZIP, each under the name the corpus keeps it by.

Read by the upload route (``routes/oib.py``). The BFF reads an upload the same
way before it forwards one (``uploadedPdfHashes`` in
``apps/workspace/bff/base-knowledge/platform/upload-hashes.ts``): ZIP or PDF by
the first bytes, a member under its normalised base name, and no member whose
name two readers could take for two names. Where the two still differed, the
store has the last word: a name it keeps never takes other bytes
(``oib_sync.store_and_request``, ADR-0165).
"""

import hashlib
import io
import os
import re
import unicodedata
import zipfile
from pathlib import Path

from fastapi import HTTPException
from fastapi import UploadFile
from fastapi import status

# Upper bound for a single base-corpus PDF (the largest shipped OIB PDF is ~15 MB).
# Also the cap applied per member AND to the total extracted payload of a ZIP.
MAX_OIB_UPLOAD_BYTES = 100 * 1024 * 1024

# What a ZIP's bytes start with: a local file header, an empty archive's end record, a spanned archive's marker.
# The BFF decides by the same bytes (`ZIP_MAGIC` in `apps/workspace/bff/base-knowledge/platform/upload-hashes.ts`).
ZIP_MAGIC = (b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08")


def sanitize_pdf_name(raw: str | None) -> str:
    """Basename-only, PDF-only filename for a corpus upload (400 otherwise)."""
    name = normalised_name(Path(raw or "").name)
    if not name or "\0" in name or not name.lower().endswith(".pdf"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A .pdf file is required")
    return name


def normalised_name(name: str) -> str:
    """A file name as the corpus compares it: NFC, no surrounding whitespace (the BFF's `corpusName`)."""
    return unicodedata.normalize("NFC", name).strip()


# The name the product gives an attached text: its manifestation's key and twelve hex digits of its sha256
# (`corpus_text_name` in `routes/public_source_capture.py`, `textFileName` in the BFF).
_TEXT_NAME = re.compile(r"[a-z0-9][a-z0-9._-]{0,99}-([0-9a-f]{12})\.pdf")


def squats_a_text_name(name: str, content: bytes) -> bool:
    """Whether ``name`` has the form of an attached text's name and ``content`` is not the bytes it names.

    Such a name says what its bytes are. A plain upload that put other bytes under it would hold the name against the
    text a later import or attach would keep there, for good: a corpus file's bytes never change (ADR-0165).
    """
    named = _TEXT_NAME.fullmatch(name)
    return named is not None and hashlib.sha256(content).hexdigest()[:12] != named.group(1)


SQUATTED_NAME_REASON = "the name ends in twelve hex digits that are not the sha256 of the file's bytes"


def is_zip_upload(upload: UploadFile, content: bytes) -> bool:
    """Whether the upload is a ZIP of PDFs: decided by its first bytes, and its name has to agree.

    The BFF hashes what an upload would store before it forwards it (`uploadedPdfHashes`), so both
    tiers must read one upload as the same thing. The part's content type is the sender's word
    and decides nothing: a ZIP sent as `innocent.pdf` once read as one PDF there and as an archive here.
    """
    is_zip = content.startswith(ZIP_MAGIC)
    if is_zip != (upload.filename or "").strip().lower().endswith(".zip"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The file's name and its content disagree: a ZIP archive is named .zip, and nothing else is",
        )
    return is_zip


def is_safe_zip_member(member_name: str, base_dir: Path) -> bool:
    """Reject zip-slip: absolute paths and members that escape ``base_dir``."""
    if not member_name or member_name.endswith("/"):
        return False  # directory entry
    # A NUL (zipfile itself cuts a name there, another reader does not), a backslash (a separator to
    # some readers, a character to others) or a `..` step: two readers could keep such a member under
    # two names, so it is kept under none.
    if "\0" in member_name or "\\" in member_name or ".." in member_name.split("/"):
        return False
    if Path(member_name).is_absolute() or member_name.startswith("/"):
        return False
    base_resolved = base_dir.resolve()
    try:
        target = (base_dir / member_name).resolve()
    except OSError, ValueError:
        return False
    return target == base_resolved or base_resolved in target.parents


def _open_archive(content: bytes) -> zipfile.ZipFile:
    """The upload as an archive (400 when it is none), refused whole when it holds one member path twice.

    This reader would keep the first copy of such a path and another reader the last (the BFF's does), so the two
    tiers would not be speaking of the same bytes. The BFF refuses the same archive (``uploadedPdfHashes``).
    """
    try:
        archive = zipfile.ZipFile(io.BytesIO(content))
    except zipfile.BadZipFile as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid ZIP archive: {exc}") from exc
    paths = [normalised_name(member.orig_filename) for member in archive.infolist() if not member.is_dir()]
    if len(set(paths)) != len(paths):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="The ZIP holds one member path twice; remove the duplicate"
        )
    return archive


def extract_zip_pdfs(content: bytes) -> tuple[list[tuple[str, bytes]], list[tuple[str, str]]]:
    """Safely extract member PDFs from a ZIP upload.

    Returns ``(accepted, rejected)`` where ``accepted`` is a list of
    ``(basename, bytes)`` and ``rejected`` is a list of ``(name, reason)``.
    Enforces zip-slip safety (absolute/escaping paths rejected), skips
    directories and non-``.pdf`` members, and caps both each member and the
    running total at :data:`MAX_OIB_UPLOAD_BYTES`. A ``base_dir`` is only used as
    the anchor for the resolved-path escape check; nothing is written there.
    """
    accepted: list[tuple[str, bytes]] = []
    rejected: list[tuple[str, str]] = []
    seen_names: set[str] = set()
    total_bytes = 0
    # A stable, non-existent anchor for the zip-slip resolved-path check.
    base_dir = Path(os.getcwd()) / "__oib_zip_extract__"

    archive = _open_archive(content)
    for member in archive.infolist():
        # The name as the archive spells it: `filename` is already cut at a NUL.
        member_name = member.orig_filename
        if member.is_dir() or member_name.endswith("/"):
            continue
        display = Path(member.filename).name or member.filename
        if not is_safe_zip_member(member_name, base_dir):
            rejected.append((display, "unsafe name (a NUL, a backslash, absolute or one that leaves the archive)"))
            continue
        if not member_name.lower().endswith(".pdf"):
            rejected.append((display, "not a .pdf"))
            continue
        base_name = normalised_name(member_name.rsplit("/", 1)[-1])
        if base_name in seen_names:
            rejected.append((base_name, "duplicate member name"))
            continue
        if member.file_size == 0:
            rejected.append((base_name, "empty file"))
            continue
        if member.file_size > MAX_OIB_UPLOAD_BYTES:
            rejected.append((base_name, f"exceeds {MAX_OIB_UPLOAD_BYTES // (1024 * 1024)} MB per-file limit"))
            continue
        if total_bytes + member.file_size > MAX_OIB_UPLOAD_BYTES:
            rejected.append((base_name, f"total extracted size exceeds {MAX_OIB_UPLOAD_BYTES // (1024 * 1024)} MB"))
            continue
        try:
            data = archive.read(member)
        except Exception as exc:
            rejected.append((base_name, f"could not read member: {exc}"))
            continue
        if squats_a_text_name(base_name, data):
            rejected.append((base_name, SQUATTED_NAME_REASON))
            continue
        seen_names.add(base_name)
        total_bytes += len(data)
        accepted.append((base_name, data))

    return accepted, rejected
