"""The HTTP client the ingest worker uses for the BFF and the object store.

A restart of the BFF or the store, or a blip in the path to it, refuses or drops a connect for
a few seconds. Each call that met it lost its piece for good: no page text, no
image, no permit record, a thumbnail never uploaded, a document treated as
present. This client retries a failed CONNECT and nothing else.

Why connect only: httpcore repeats a connect that raised ``ConnectError`` or
``ConnectTimeout`` before one byte of the request left the process, so the
server never saw it. That is safe for any method, the POST that mints a
presigned slot included. A request the server may have received is never sent
twice here, so a write cannot land twice.

The same policy as the download in ``apps/agent-host`` (``DeferredObjectDownload``),
which is where ``CONNECT_RETRIES`` was measured.
"""

from __future__ import annotations

import httpx

#: Connect attempts after the first, backing off 0, 0.5, 1, 2, 4, 8 s: about
#: 15 s in all, longer than the BFF's restart and database blips PostHog Logs
#: has shown.
CONNECT_RETRIES = 6

#: Per connect attempt. Each of the retries gets its own bound, so a store that
#: drops SYNs cannot hold a worker for the whole read budget times seven.
CONNECT_TIMEOUT_SECONDS = 5.0


def connect_retrying_client(*, read_timeout: float) -> httpx.Client:
    """A client whose connect is retried; redirects are not followed.

    A presigned URL or the internal route must not be sent somewhere ``Location``
    names, so a 3xx stays an answer, as it was with ``httpx.post``.
    """
    return httpx.Client(
        transport=httpx.HTTPTransport(retries=CONNECT_RETRIES),
        timeout=httpx.Timeout(read_timeout, connect=CONNECT_TIMEOUT_SECONDS),
        follow_redirects=False,
    )
