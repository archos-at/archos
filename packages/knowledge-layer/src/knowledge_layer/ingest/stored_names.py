import re

_TMP_UPLOAD_PREFIX = re.compile(r"^tmp.{8}_")


def _normalized_file_name(name: str | None) -> str:
    from urllib.parse import unquote

    return unquote(_TMP_UPLOAD_PREFIX.sub("", name or ""))


def _stored_name_matches(requested: str, stored: str) -> bool:
    from urllib.parse import unquote

    stripped = _TMP_UPLOAD_PREFIX.sub("", stored or "")
    return requested in (stripped, unquote(stripped))


def _stored_spellings(name: str) -> set[str]:
    from urllib.parse import quote

    plain = _normalized_file_name(name)
    return {name, plain, quote(plain), quote(plain, safe="!'()*~")}


def _replacement_lock_key(collection_name: str, file_name: str) -> str:
    return f"reingest:{collection_name}:{_normalized_file_name(file_name)}"
