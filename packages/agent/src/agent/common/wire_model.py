"""The two base models every chat wire v2 model stands on (``common/wire_v2.py``).

Split out of ``wire_v2`` so that module can keep its contract without passing
the size limit; nothing but the wire builds on them.
"""

from __future__ import annotations

from typing import Any
from typing import Literal
from typing import get_args
from typing import get_origin

from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import SerializationInfo
from pydantic import SerializerFunctionWrapHandler
from pydantic import model_serializer


def _is_const(annotation: Any) -> bool:
    return get_origin(annotation) is Literal and len(get_args(annotation)) == 1


class WireModel(BaseModel):
    """Closed models: a field the contract does not name is a producer bug.

    A frame omits every field at its default (:func:`wire_v2.to_frame` dumps with
    ``exclude_defaults``) except the ``const`` ones, which are the discriminators
    (``v``, ``type``, ``name``, ``kind``) and must always be on the wire. The
    reader's schema restores the defaults, so the frame stays minimal and still
    parses to the same value.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    @model_serializer(mode="wrap")
    def _keep_consts(self, handler: SerializerFunctionWrapHandler, info: SerializationInfo) -> dict[str, Any]:
        data = handler(self)
        if info.exclude_defaults:
            consts = {
                name: getattr(self, name) for name, f in type(self).model_fields.items() if _is_const(f.annotation)
            }
            data = {**consts, **data}
        return data


class OpenWireModel(BaseModel):
    """A payload whose full contract lives elsewhere (cards, sources, ledger).

    The wire names the fields it routes on and passes the rest through; the
    owning contract validates the whole (``answerCardSchema``, the citation wire,
    ``sanitizeAnswerMeta``).
    """

    model_config = ConfigDict(extra="allow", frozen=True)
