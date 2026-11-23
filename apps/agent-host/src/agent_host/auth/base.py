from abc import ABC
from abc import abstractmethod
from typing import Any


class TokenValidator(ABC):
    @abstractmethod
    async def validate(self, token: str) -> tuple[dict[str, Any] | None, str | None]: ...

    @abstractmethod
    def can_handle(self, token: str) -> bool: ...
