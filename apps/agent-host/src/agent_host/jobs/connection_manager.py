from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator

logger = logging.getLogger(__name__)


class SSEConnectionManager:
    def __init__(self):
        self._active_connections: set[asyncio.Task] = set()
        self._shutdown_event = asyncio.Event()
        self._lock = asyncio.Lock()

    @property
    def is_shutting_down(self) -> bool:
        return self._shutdown_event.is_set()

    @property
    def active_count(self) -> int:
        return len(self._active_connections)

    def signal_shutdown(self) -> None:
        self._shutdown_event.set()

    async def wait_or_shutdown(self, timeout: float) -> bool:
        try:
            await asyncio.wait_for(self._shutdown_event.wait(), timeout=timeout)
            return True  # Shutdown was signaled
        except TimeoutError:
            return False  # Normal timeout, no shutdown

    async def register(self, task: asyncio.Task) -> None:
        async with self._lock:
            self._active_connections.add(task)
            logger.debug("SSE connection registered, active count: %d", len(self._active_connections))

    async def unregister(self, task: asyncio.Task) -> None:
        async with self._lock:
            self._active_connections.discard(task)
            logger.debug("SSE connection unregistered, active count: %d", len(self._active_connections))

    @asynccontextmanager
    async def track_connection(self) -> AsyncGenerator[None]:
        task = asyncio.current_task()
        if task:
            await self.register(task)
        try:
            yield
        finally:
            if task:
                await self.unregister(task)

    async def shutdown(self, timeout: float = 5.0) -> None:
        logger.info("SSE connection manager shutting down, %d active connections", len(self._active_connections))

        self._shutdown_event.set()

        if not self._active_connections:
            return

        await asyncio.sleep(0.1)

        async with self._lock:
            tasks_to_cancel = list(self._active_connections)

        for task in tasks_to_cancel:
            if not task.done():
                task.cancel()
                logger.debug("Cancelled SSE connection task")

        if tasks_to_cancel:
            try:
                await asyncio.wait_for(
                    asyncio.gather(*tasks_to_cancel, return_exceptions=True),
                    timeout=timeout,
                )
                logger.info("All SSE connections closed gracefully")
            except TimeoutError:
                logger.warning(
                    "Timeout waiting for SSE connections to close, %d remaining", len(self._active_connections)
                )

    def reset(self) -> None:
        self._active_connections.clear()
        self._shutdown_event.clear()


_connection_manager: SSEConnectionManager | None = None


def get_connection_manager() -> SSEConnectionManager:
    global _connection_manager
    if _connection_manager is None:
        _connection_manager = SSEConnectionManager()
    return _connection_manager


def reset_connection_manager() -> None:
    global _connection_manager
    if _connection_manager is not None:
        _connection_manager.reset()
    _connection_manager = None
