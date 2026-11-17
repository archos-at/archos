import logging
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)


FAMILY_OVERVIEW_FAILED_NOTICE = (
    "Note: the overview of the parts of OIB-Richtlinie {key} could not be built; only the ranked results "
    "follow, and each part opens on its own by its file name.\n\n"
)


@dataclass(frozen=True, slots=True)
class _FamilyBranch:
    overview: Any = None
    failed: bool = False


NO_FAMILY_BRANCH = _FamilyBranch()


FAMILY_RANKED_HITS = 4


async def family_branch(entries, family_key: str) -> _FamilyBranch:
    from knowledge_layer.read_passage import FamilyUnreadable
    from knowledge_layer.read_passage import family_overview

    try:
        return _FamilyBranch(overview=await family_overview(entries, family_key))
    except FamilyUnreadable as exc:
        logger.warning("Family overview skipped for Richtlinie %s: %s", family_key, exc)
        return _FamilyBranch(failed=True)
    except Exception:  # noqa: BLE001 — the ranked passages are always a valid answer
        logger.warning("Family overview skipped for Richtlinie %s", family_key, exc_info=True)
        return _FamilyBranch(failed=True)


def without_chunks(chunks, exclude) -> list:
    taken = {getattr(chunk, "chunk_id", None) for chunk in exclude}
    taken.discard(None)
    return [chunk for chunk in chunks if getattr(chunk, "chunk_id", None) not in taken]
