from __future__ import annotations

import logging
import re

logger = logging.getLogger(__name__)

_UNSUPPORTED_SCHEMA = re.compile(r"Unsupported schema: (IFC[0-9A-Z]{1,8}(?:_[0-9A-Z]{1,8})?)")


def parser_refusal(error: BaseException) -> str:
    logger.info("the parser refused a file: %s: %s", type(error).__name__, repr(str(error))[:200])
    named = _UNSUPPORTED_SCHEMA.fullmatch(str(error))
    if named:
        return (
            f"Diese Datei verwendet das IFC-Schema {named[1]}, das hier nicht unterstützt wird. "
            "Das Modell bitte als IFC4 oder IFC2X3 neu exportieren."
        )
    return (
        "Diese Datei lässt sich nicht lesen: Entweder wird ihr IFC-Schema nicht unterstützt oder sie ist "
        "beschädigt. Das Modell bitte neu exportieren."
    )
