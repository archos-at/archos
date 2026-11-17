from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from dataclasses import field

from agent.common import residency
from agent.common.llm_credentials import OrgLLMCredential
from agent.common.llm_credentials import get_org_llm_credential_from_context
from agent.common.llm_provider import LLMProvider
from agent.common.model_overrides import AgentGroup
from agent.common.model_overrides import get_model_overrides_from_context
from agent.common.model_overrides import get_zdr_only_from_context
from agent.common.model_overrides import resolve_org_processing_policy
from agent.common.reasoning_settings import get_reasoning_efforts
from agent.common.reasoning_settings import get_turn_reasoning_effort
from agent.common.residency import UNREADABLE_POLICY
from agent.common.residency import ProcessingPolicy

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class RequestLLMContext:

    model_overrides: dict[str, str] = field(default_factory=dict)
    reasoning_efforts: dict[str, str] = field(default_factory=dict)
    credential: OrgLLMCredential | None = None
    zdr_only: bool = False
    processing: ProcessingPolicy = UNREADABLE_POLICY

    def apply(self, provider: LLMProvider) -> LLMProvider:
        return (
            provider.with_model_overrides(self.model_overrides)
            .with_reasoning_efforts(self.reasoning_efforts)
            .with_credential(self.credential)
            .with_zdr(self.zdr_only)
        )


async def read_request_llm_context() -> RequestLLMContext:
    model_overrides, efforts, credential, zdr_only, processing = await asyncio.gather(
        _read_model_overrides(),
        _read_reasoning_efforts(),
        _read_org_credential(),
        _read_zdr_only(),
        _read_processing_policy(),
    )
    residency.record_turn_residency(processing)
    return RequestLLMContext(
        model_overrides=model_overrides,
        reasoning_efforts=efforts,
        credential=credential,
        zdr_only=zdr_only,
        processing=processing,
    )


async def _read_processing_policy() -> ProcessingPolicy:
    try:
        return await asyncio.to_thread(_processing_policy_from_context)
    except Exception:  # noqa: BLE001 - fails closed: an unreadable policy allows the service alone
        logger.warning("Processing-policy lookup failed; this turn allows the service alone", exc_info=True)
        return UNREADABLE_POLICY


def _processing_policy_from_context() -> ProcessingPolicy:
    from agent.project_context import get_organization_id_from_context

    return resolve_org_processing_policy(get_organization_id_from_context()) or UNREADABLE_POLICY


async def _read_model_overrides() -> dict[str, str]:
    try:
        return await asyncio.to_thread(get_model_overrides_from_context)
    except Exception:  # noqa: BLE001 - a lost override costs the model choice, never the turn
        logger.debug("Model-overrides lookup failed; continuing without", exc_info=True)
        return {}


async def _read_org_credential() -> OrgLLMCredential | None:
    try:
        return await asyncio.to_thread(get_org_llm_credential_from_context)
    except Exception:  # noqa: BLE001 - see above; the env chain still has a credential
        logger.debug("Org-credential lookup failed; continuing without", exc_info=True)
        return None


async def _read_reasoning_efforts() -> dict[str, str]:
    try:
        efforts = await asyncio.to_thread(get_reasoning_efforts)
    except Exception:  # noqa: BLE001 - a lost effort costs the thinking level, never the turn
        logger.debug("Reasoning-efforts lookup failed; continuing with the configured levels", exc_info=True)
        efforts = {}
    return with_turn_effort(efforts, get_turn_reasoning_effort())


def with_turn_effort(efforts: dict[str, str], turn_effort: str | None) -> dict[str, str]:
    if turn_effort is None:
        return efforts
    return {**efforts, AgentGroup.RESEARCH.value: turn_effort}


async def _read_zdr_only() -> bool:
    try:
        return await asyncio.to_thread(get_zdr_only_from_context)
    except residency.ResidencyViolation:
        raise  # an organization this cell may not serve: the turn stops here, it is not a lookup failure
    except Exception:  # noqa: BLE001 - fails CLOSED, unlike its three siblings
        logger.error("ZDR lookup failed; pinning ZDR routing for this turn", exc_info=True)
        return True
