"""Which module serves a question set of the answer suite (``suite.py``), by the set's name."""

from __future__ import annotations

from types import ModuleType


def set_module(name: str | None) -> ModuleType | None:
    """A set's own module: its ``load_questions()``, and the ``report_lines(runs, meta)`` it adds to the report."""
    import edition_eval
    import files_eval
    import golden_eval
    import north_star_eval
    import visual_eval
    import workspace_eval

    return {
        "workspace": workspace_eval,
        "files": files_eval,
        "visual": visual_eval,
        "north-star": north_star_eval,
        "editions": edition_eval,
        "golden": golden_eval,
    }.get(str(name))
