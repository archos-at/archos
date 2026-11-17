from __future__ import annotations

import io
import threading
from collections import OrderedDict

import httpx

BLOCK_SIZE = 1024 * 1024

CACHE_BLOCKS = 64


class RemoteFileError(OSError): ...


class RangeFile(io.RawIOBase):
    def __init__(self, url: str, size: int, client: httpx.Client) -> None:
        super().__init__()
        self._url = url
        self._size = size
        self._client = client
        self._position = 0
        self._blocks: OrderedDict[int, bytes] = OrderedDict()
        self._lock = threading.Lock()
        self.last_error: RemoteFileError | None = None

    def clear_error(self) -> None:
        self.last_error = None

    def renew(self, url: str) -> None:
        self._url = url

    def prove(self, url: str) -> None:
        try:
            response = self._client.get(url, headers={"Range": "bytes=0-0"})
        except httpx.HTTPError as error:
            raise RemoteFileError(f"proof read: {type(error).__name__}") from error
        if response.status_code != 206 or len(response.content) != 1:
            raise RemoteFileError(f"proof read answered {response.status_code} with {len(response.content)} bytes")

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self._position

    def get_size(self) -> int:
        return self._size

    def seek(self, offset: int, whence: int = io.SEEK_SET) -> int:
        base = {io.SEEK_SET: 0, io.SEEK_CUR: self._position, io.SEEK_END: self._size}[whence]
        target = base + offset
        if target < 0:
            raise ValueError("negative seek position")
        self._position = target
        return target

    def read(self, size: int = -1) -> bytes:
        end = self._size if size < 0 else min(self._size, self._position + size)
        if self._position >= end:
            return b""
        parts = [self._slice(offset, end) for offset in _block_starts(self._position, end)]
        data = b"".join(parts)
        self._position += len(data)
        return data

    def readinto(self, buffer) -> int:  # noqa: ANN001 - the io protocol's own signature
        data = self.read(len(buffer))
        buffer[: len(data)] = data
        return len(data)

    def _slice(self, block_start: int, end: int) -> bytes:
        block = self._block(block_start)
        lo = max(self._position, block_start) - block_start
        hi = min(end, block_start + len(block)) - block_start
        return block[lo:hi]

    def _block(self, start: int) -> bytes:
        with self._lock:
            cached = self._blocks.get(start)
            if cached is not None:
                self._blocks.move_to_end(start)
                return cached
        block = self._fetch(start, min(self._size, start + BLOCK_SIZE) - 1)
        with self._lock:
            self._blocks[start] = block
            while len(self._blocks) > CACHE_BLOCKS:
                self._blocks.popitem(last=False)
        return block

    def _fetch(self, first: int, last: int) -> bytes:
        try:
            response = self._client.get(self._url, headers={"Range": f"bytes={first}-{last}"})
        except httpx.HTTPError as error:
            raise self._failed(f"range {first}-{last}: {type(error).__name__}") from error
        expected = last - first + 1
        if response.status_code != 206 or len(response.content) != expected:
            raise self._failed(
                f"range {first}-{last} answered {response.status_code} with {len(response.content)} bytes"
            )
        return response.content

    def _failed(self, detail: str) -> RemoteFileError:
        self.last_error = RemoteFileError(detail)
        return self.last_error


def _block_starts(start: int, end: int) -> range:
    first = start - start % BLOCK_SIZE
    return range(first, end, BLOCK_SIZE)
