from __future__ import annotations

from .score_definition import ScoreDefinition

EXECUTE_STATUSES = ("ok", "error", "timeout", "unavailable", "refused")

EXECUTE_SCORE_DEFINITIONS: tuple[ScoreDefinition, ...] = (
    ScoreDefinition(
        name="execute-status",
        data_type="CATEGORICAL",
        description=(
            "Per `execute` run, on the turn's trace: how it ended. `ok`, `error` (the script threw or the runner "
            "refused it), `timeout`, `unavailable` (no runner, or it could not be reached or stayed busy), "
            "`refused` (nothing was sent: no conversation, a document that could not be read, over 50 MB). The "
            "comment names the reason of an unavailable or refused run. The share `error` is the run error rate."
        ),
        categories=EXECUTE_STATUSES,
    ),
    ScoreDefinition(
        name="execute-runs-to-file",
        data_type="NUMERIC",
        description=(
            "On an `execute` run that kept at least one file: how many runs the turn made since its last run that "
            "kept one, this run included. 1 is a file on the first try; the mean is the tries until a file."
        ),
        min_value=1,
    ),
    ScoreDefinition(
        name="execute-files-made",
        data_type="NUMERIC",
        description=(
            "Per `execute` run that reached the runner: how many files it kept that were new to the working "
            "directory (a file it rewrote is not counted again). Zero is a measurement. Summed against "
            "`execute-files-filed`, the share of made files that went into the project."
        ),
        min_value=0,
    ),
    ScoreDefinition(
        name="execute-files-filed",
        data_type="NUMERIC",
        description=(
            "1 when `file_draft` first files a working-directory file an `execute` run made, on the trace of the "
            "turn that filed it, which may be a later turn than the one that made it. Summed against "
            "`execute-files-made`, the share of made files that went into the project."
        ),
        min_value=0,
        max_value=1,
    ),
)
