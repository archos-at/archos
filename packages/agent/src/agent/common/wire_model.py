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
    model_config = ConfigDict(extra="allow", frozen=True)
