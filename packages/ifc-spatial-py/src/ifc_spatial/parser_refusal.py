"""The reason a person reads when the IFC parser refused a file."""

from __future__ import annotations

import logging
import re

logger = logging.getLogger(__name__)

#: How IfcOpenShell words a schema it does not implement, for a name shaped like
#: an IFC schema's. A failure worded differently gets the general reason.
_UNSUPPORTED_SCHEMA = re.compile(r"Unsupported schema: (IFC[0-9A-Z]{1,8}(?:_[0-9A-Z]{1,8})?)")


def parser_refusal(error: BaseException) -> str:
    """The reason for a file the parser refused, which a person reads and an agent passes on.

    The parser's own words stay out of it: English, about its internals, and the
    schema's name in them is whatever the file says, sentences included. So a name
    goes in only if it has the shape of one.
    """
    # INFO, because from WARNING up the logs leave for PostHog, and this text is the file's.
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
