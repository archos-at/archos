from __future__ import annotations

import asyncio
import contextvars
import dataclasses
import json
import logging
import os
import re
import time
from collections.abc import Callable
from collections.abc import Iterator
from collections.abc import Mapping
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

import httpx

from agent.common import credit_retry
from agent.common import provider_limiter
from agent.common import residency
from agent.common.licensed_text import licensed_scope_active
from agent.common.licensed_text import refuse_unattested_model_read

logger = logging.getLogger(__name__)

OPENROUTER_HOST = "openrouter.ai"

ZDR_PROVIDER_ROUTING: Mapping[str, object] = {"zdr": True, "data_collection": "deny"}

DATA_POLICY_REFUSAL_MARKER = "data policy"

PREFERRED_PROVIDERS_ENV = "OPENROUTER_PREFERRED_PROVIDERS"
_DEFAULT_PREFERRED_PROVIDERS = (
    "azure/eu",
    "google-vertex/europe",
    "google-vertex/eu",
    "amazon-bedrock/eu-west-1",
    "mistral/eu",
    "azure/swedencentral",
)


def preferred_providers() -> tuple[str, ...]:
    raw = os.environ.get(PREFERRED_PROVIDERS_ENV)
    if raw is None:
        return _DEFAULT_PREFERRED_PROVIDERS
    return tuple(slug.strip() for slug in raw.split(",") if slug.strip())


def targets_openrouter(url: object) -> bool:
    if not url:
        return False
    text = str(url)
    host = (urlsplit(text).hostname if "://" in text else text.split("/", 1)[0]) or ""
    return host == OPENROUTER_HOST or host.endswith(f".{OPENROUTER_HOST}")


VISION_REASONING = {"effort": "low"}


def vision_reasoning_body(base_url: object) -> dict[str, Any]:
    return {"reasoning": dict(VISION_REASONING)} if targets_openrouter(base_url) else {}


def vision_extra_body(client: object) -> dict[str, Any]:
    reasoning = vision_reasoning_body(getattr(client, "base_url", None))
    return {"extra_body": reasoning} if reasoning else {}


@dataclass(frozen=True)
class DataPolicy:

    zdr: bool = False
    eu_only: bool = False

    def for_page_reads(self) -> DataPolicy:
        return dataclasses.replace(self, eu_only=True) if self.zdr else self

    def apply(self, body: Mapping[str, Any] | None) -> dict[str, Any]:
        merged: dict[str, Any] = dict(body) if isinstance(body, Mapping) else {}
        if not self.zdr:
            return merged
        existing = merged.get("provider")
        provider = dict(existing) if isinstance(existing, Mapping) else {}
        provider.update(ZDR_PROVIDER_ROUTING)
        order = preferred_providers()
        if self.eu_only and order and not {"order", "only"} & provider.keys():
            provider["only"] = list(order)
            provider["allow_fallbacks"] = False
        elif order and "order" not in provider:
            provider["order"] = list(order)
            provider.setdefault("allow_fallbacks", True)
        merged["provider"] = provider
        return merged

    def is_applied_to(self, body: Mapping[str, Any] | None) -> bool:
        if not self.zdr:
            return True
        provider = body.get("provider") if isinstance(body, Mapping) else None
        return isinstance(provider, Mapping) and all(provider.get(k) == v for k, v in ZDR_PROVIDER_ROUTING.items())


NO_RETENTION_LIMITS = DataPolicy(zdr=False)
ZERO_DATA_RETENTION = DataPolicy(zdr=True)

PLATFORM_FIXED = ZERO_DATA_RETENTION


def data_policy_for(organization_id: str | None) -> DataPolicy:
    if not organization_id:
        return ZERO_DATA_RETENTION if residency.active_cell() is not None else NO_RETENTION_LIMITS
    try:
        from agent.common.model_overrides import resolve_org_processing_policy
        from agent.common.model_overrides import resolve_org_zdr_only

        if residency.active_cell() is not None:  # an organization this cell may not serve gets no policy at all
            residency.check_organization(resolve_org_processing_policy(organization_id) or residency.UNREADABLE_POLICY)
        return ZERO_DATA_RETENTION if resolve_org_zdr_only(organization_id) else NO_RETENTION_LIMITS
    except residency.ResidencyViolation:
        raise
    except Exception:  # noqa: BLE001 - fails closed, and says so
        logger.error("ZDR policy lookup failed for org %s; pinning ZDR routing", organization_id, exc_info=True)
        return ZERO_DATA_RETENTION


class ZdrRoutingError(RuntimeError):
    ...


def is_data_policy_refusal(exc: BaseException) -> bool:
    seen: set[int] = set()
    current: BaseException | None = exc
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        text = str(current).lower()
        if DATA_POLICY_REFUSAL_MARKER in text or ("no endpoints found" in text and "retention" in text):
            return True
        current = current.__cause__ or current.__context__
    return False


def pin_chat_model(llm: object, policy: DataPolicy) -> object:
    if not policy.zdr:
        return llm
    from agent.common.llm_factory import llm_targets_openrouter

    if not llm_targets_openrouter(llm):
        return llm
    current = getattr(llm, "extra_body", None)
    if policy.is_applied_to(current):
        return llm
    if not hasattr(llm, "extra_body") or not hasattr(llm, "model_copy"):
        raise ZdrRoutingError(f"cannot pin {type(llm).__name__} to ZDR endpoints: no extra_body")
    try:
        pinned = llm.model_copy(update={"extra_body": policy.apply(current)})
    except Exception as exc:
        raise ZdrRoutingError(f"cannot pin {type(llm).__name__} to ZDR endpoints") from exc

    from agent.common.model_overrides import _rebind_instance_method_patches

    _rebind_instance_method_patches(llm, pinned)
    return pinned


def _pinned_request(request: httpx.Request, policy: DataPolicy) -> httpx.Request:
    request = _routed_request(request)
    on_openrouter = targets_openrouter(str(request.url))
    refuse_unattested_model_read(str(request.url.host), openrouter=on_openrouter)
    if licensed_scope_active():
        policy = ZERO_DATA_RETENTION
    if not policy.zdr or request.method != "POST" or not targets_openrouter(str(request.url)):
        return request
    try:
        body = json.loads(request.content or b"null")
    except ValueError:
        body = None
    if not isinstance(body, dict):
        raise ZdrRoutingError(f"cannot pin a non-JSON request to {request.url.path} to ZDR endpoints")
    if policy.is_applied_to(body):
        return request
    headers = {k: v for k, v in request.headers.items() if k.lower() != "content-length"}
    return httpx.Request(
        request.method,
        request.url,
        headers=headers,
        content=json.dumps(policy.apply(body)).encode("utf-8"),
        extensions=request.extensions,
    )


def _routed_request(request: httpx.Request) -> httpx.Request:
    target, _route = residency.enforce(str(request.url))
    if target == str(request.url):
        return request
    headers = {k: v for k, v in request.headers.items() if k.lower() != "host"}
    try:  # a JSON body is read already; a multipart upload (dictation) still streams, and must not be read here
        body: dict[str, Any] = {"content": request.content}
    except httpx.RequestNotRead:
        body = {"stream": request.stream}
    return httpx.Request(request.method, target, headers=headers, extensions=request.extensions, **body)


_MODEL_FIELD = re.compile(rb'"model"\s*:\s*"([^"]{1,120})"')


def _request_model(request: httpx.Request) -> str | None:
    try:
        body = request.content
    except httpx.RequestNotRead:
        return None
    at = body.find(b'"model"')
    found = _MODEL_FIELD.match(body, at) if at >= 0 else None
    return found.group(1).decode("utf-8", "replace") if found else None


def _slot_wait(request: httpx.Request, cls: str | None = None) -> float | None:
    if (cls or provider_limiter.current_class()) != provider_limiter.CHAT:
        return None
    timeouts = request.extensions.get("timeout")
    return timeouts.get("pool") if isinstance(timeouts, dict) else None


def _takes_slot(request: httpx.Request) -> bool:
    return targets_openrouter(str(request.url))


def _scope_of_body(body: bytes) -> str:
    try:
        return provider_limiter.scope_of_error(json.loads(body))
    except ValueError:
        return provider_limiter.MODEL_SCOPE


def _scope_of_response(read: Callable[[], bytes]) -> str:
    try:
        return _scope_of_body(read())
    except Exception:  # noqa: BLE001 - an unreadable body is unclassifiable, which counts against the model
        return provider_limiter.MODEL_SCOPE


async def _ascope_of_response(response: httpx.Response) -> str:
    try:
        return _scope_of_body(await response.aread())
    except Exception:  # noqa: BLE001 - see _scope_of_response
        return provider_limiter.MODEL_SCOPE


def _pool_timeout(request: httpx.Request, error: provider_limiter.ProviderWaitTimeout) -> httpx.PoolTimeout:
    return httpx.PoolTimeout(str(error), request=request)


class _ReleasingStream(httpx.SyncByteStream):

    def __init__(self, inner: httpx.SyncByteStream, lease: provider_limiter.Lease) -> None:
        self._inner = inner
        self._lease = lease

    def __iter__(self):
        yield from self._inner
        self._lease.release()

    def close(self) -> None:
        try:
            self._inner.close()
        finally:
            self._lease.release()


class _AsyncReleasingStream(httpx.AsyncByteStream):

    def __init__(self, inner: httpx.AsyncByteStream, lease: provider_limiter.Lease) -> None:
        self._inner = inner
        self._lease = lease

    async def __aiter__(self):
        async for chunk in self._inner:
            yield chunk
        await self._lease.arelease()

    async def aclose(self) -> None:
        try:
            await self._inner.aclose()
        finally:
            await self._lease.arelease()


class _PinningTransport(httpx.BaseTransport):

    def __init__(self, policy: DataPolicy, cls: str | None = None, inner: httpx.BaseTransport | None = None) -> None:
        self._policy = policy
        self._cls = cls
        self._inner = inner or httpx.HTTPTransport()

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        residency.check_current_organization()
        request = _pinned_request(request, self._policy)
        if not _takes_slot(request):
            return self._inner.handle_request(request)
        model = _request_model(request)
        for attempt in range(credit_retry.MAX_RETRIES + 1):
            try:
                lease = provider_limiter.acquire(
                    cls=self._cls, model=model, max_wait_seconds=_slot_wait(request, self._cls)
                )
            except provider_limiter.ProviderWaitTimeout as error:
                raise _pool_timeout(request, error) from error
            try:
                response = self._inner.handle_request(request)
                if response.status_code == 429:
                    provider_limiter.throttle(model, _scope_of_response(response.read))
                elif response.status_code == 402 and attempt < credit_retry.MAX_RETRIES:
                    if credit_retry.is_transient_credit_402(402, response.read()):
                        response.close()
                        lease.release()
                        logger.warning("Provider 402 (in-flight credits); retry %s", attempt + 1)
                        time.sleep(credit_retry.delay_seconds(attempt))
                        continue
            except BaseException:
                lease.release()
                raise
            break
        if response.is_closed:  # a body already read in full leaves nothing to wait for
            lease.release()
        else:
            response.stream = _ReleasingStream(response.stream, lease)
        return response

    def close(self) -> None:
        self._inner.close()


class _AsyncPinningTransport(httpx.AsyncBaseTransport):
    def __init__(
        self, policy: DataPolicy, cls: str | None = None, inner: httpx.AsyncBaseTransport | None = None
    ) -> None:
        self._policy = policy
        self._cls = cls
        self._inner = inner or httpx.AsyncHTTPTransport()

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        await residency.acheck_current_organization()
        request = _pinned_request(request, self._policy)
        if not _takes_slot(request):
            return await self._inner.handle_async_request(request)
        model = _request_model(request)
        for attempt in range(credit_retry.MAX_RETRIES + 1):
            try:
                lease = await provider_limiter.aacquire(
                    cls=self._cls, model=model, max_wait_seconds=_slot_wait(request, self._cls)
                )
            except provider_limiter.ProviderWaitTimeout as error:
                raise _pool_timeout(request, error) from error
            try:
                response = await self._inner.handle_async_request(request)
                if response.status_code == 429:
                    await provider_limiter.athrottle(model, await _ascope_of_response(response))
                elif response.status_code == 402 and attempt < credit_retry.MAX_RETRIES:
                    if credit_retry.is_transient_credit_402(402, await response.aread()):
                        await response.aclose()
                        await lease.arelease()
                        logger.warning("Provider 402 (in-flight credits); retry %s", attempt + 1)
                        await asyncio.sleep(credit_retry.delay_seconds(attempt))
                        continue
            except BaseException:
                await lease.arelease()
                raise
            break
        if response.is_closed:
            await lease.arelease()
        else:
            response.stream = _AsyncReleasingStream(response.stream, lease)
        return response

    async def aclose(self) -> None:
        await self._inner.aclose()


_scoped_policy: contextvars.ContextVar[DataPolicy | None] = contextvars.ContextVar(
    "openrouter_data_policy", default=None
)


@contextmanager
def data_policy_scope(policy: DataPolicy) -> Iterator[DataPolicy]:
    token = _scoped_policy.set(policy)
    try:
        yield policy
    finally:
        _scoped_policy.reset(token)


def scoped_data_policy() -> DataPolicy:
    scoped = _scoped_policy.get()
    return scoped if scoped is not None else ZERO_DATA_RETENTION


def openai_client(*, base_url: str, api_key: str, policy: DataPolicy, **kwargs: Any):
    from openai import OpenAI

    return OpenAI(base_url=base_url, api_key=api_key, http_client=pinned_http_client(policy), **kwargs)


def pinned_http_client(policy: DataPolicy = PLATFORM_FIXED, **kwargs: Any) -> httpx.Client:
    return httpx.Client(transport=_PinningTransport(policy), **kwargs)


def pinned_async_http_client(policy: DataPolicy = PLATFORM_FIXED, **kwargs: Any) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=_AsyncPinningTransport(policy), **kwargs)


def limited_async_http_client(
    *, cls: str | None = None, inner: httpx.AsyncBaseTransport | None = None, **kwargs: Any
) -> httpx.AsyncClient:
    _checked_class(cls)
    return httpx.AsyncClient(transport=_AsyncPinningTransport(NO_RETENTION_LIMITS, cls, inner), **kwargs)


def _checked_class(cls: str | None) -> None:
    if cls is not None:
        provider_limiter.checked_class(cls)
