import asyncio
import functools
import logging
import os
import signal
from collections.abc import Callable
from collections.abc import Mapping
from typing import Any
from typing import override

from fastapi import APIRouter
from fastapi import FastAPI
from pydantic import Field
from pydantic import model_validator

from agent.common.data_flow_register import assert_no_latent_vendor
from agent.common.log_redaction import install_presigned_url_scrubbing
from agent.common.residency import assert_residency
from agent.knowledge.leader_lock import require_direct_dsns
from agent.observability import posthog_exceptions
from agent.stages.delivery import register_stage_frame_sink
from agent_host.auth.middleware import AuthMiddleware
from agent_host.context_envelope import RequestContextEnvelopeMiddleware
from agent_host.legacy_headers import LegacyHeaderNamesMiddleware
from nat.builder.workflow_builder import WorkflowBuilder
from nat.cli.register_workflow import register_front_end  # noqa: TID251
from nat.data_models.config import Config
from nat.data_models.step_adaptor import StepAdaptorConfig
from nat.data_models.step_adaptor import StepAdaptorMode
from nat.front_ends.fastapi.fastapi_front_end_config import FastApiFrontEndConfig
from nat.front_ends.fastapi.fastapi_front_end_plugin import FastApiFrontEndPlugin
from nat.front_ends.fastapi.fastapi_front_end_plugin_worker import FastApiFrontEndPluginWorker
from nat.front_ends.fastapi.fastapi_front_end_plugin_worker import FastApiFrontEndPluginWorkerBase
from nat.runtime.session import SessionManager

from .chat_auth import configure_websocket_auth
from .chat_registry import drain_chat_turns
from .chat_registry import send_stage
from .chat_socket import chat_socket_endpoint
from .health import install_health_route
from .inflight import InFlightMiddleware
from .jobs.connection_manager import get_connection_manager
from .jobs.event_store import EventStore
from .roles import WebRole
from .roles import web_role
from .routes.cards import add_card_catalog_routes
from .routes.chat_occupancy import add_chat_occupancy_routes
from .routes.cleanup_proposal import add_cleanup_proposal_routes
from .routes.collections import add_collection_routes
from .routes.config_info import add_config_info_routes
from .routes.consistency_check import add_consistency_check_routes
from .routes.dictation import add_dictation_routes
from .routes.document_search import add_document_search_routes
from .routes.documents import add_document_routes
from .routes.drafts import add_draft_routes
from .routes.drawing_renditions import add_drawing_rendition_routes
from .routes.feedback_digest import add_feedback_digest_routes
from .routes.filing_fit import add_filing_fit_routes
from .routes.folder_proposals import add_folder_proposals_routes
from .routes.generate_conversation_title import add_generate_conversation_title_routes
from .routes.generate_summary import add_generate_summary_routes
from .routes.ingest import add_ingest_routes
from .routes.internal_tools import add_internal_tool_routes
from .routes.jobs import register_job_routes
from .routes.knowledge_mark import add_knowledge_mark_routes
from .routes.lesson_distill import add_lesson_distill_routes
from .routes.mail import add_mail_routes
from .routes.mail_archive import add_mail_archive_routes
from .routes.maintenance import add_maintenance_routes
from .routes.norms import add_norm_routes
from .routes.note_embeddings import add_note_embedding_routes
from .routes.oib import add_oib_routes
from .routes.project_experience import add_project_experience_routes
from .routes.project_facts import add_project_facts_routes
from .routes.public_source_capture import add_public_source_capture_routes
from .routes.revision_compare import add_revision_compare_routes
from .routes.ris import add_ris_routes
from .routes.similar_passages import add_similar_passages_routes
from .routes.skill_review import add_skill_review_routes
from .routes.skills import add_skill_routes
from .startup_banner import log_boot_line

logger = logging.getLogger(__name__)

CHAT_SOCKET_PATH = "/websocket"

register_stage_frame_sink(send_stage)


_validators: list = []


def register_validator(validator) -> None:
    _validators.append(validator)


def _load_validators_from_entry_points() -> list:
    from importlib.metadata import entry_points

    validators = []
    for ep in entry_points(group="agent_host.validators"):
        try:
            factory = ep.load()
            result = factory()
            validators.extend(result if isinstance(result, list) else [result])
            logger.info(
                "Loaded validators from entry point '%s': %s",
                ep.name,
                [type(v).__name__ for v in (result if isinstance(result, list) else [result])],
            )
        except Exception as e:
            logger.warning("Failed to load validators from entry point '%s': %s", ep.name, e)
    return validators


WORKFLOW_ROUTE_FIELDS = (
    "path",
    "legacy_path",
    "openai_api_path",
    "legacy_openai_api_path",
    "openai_api_v1_path",
    "websocket_path",
)


class AgentHostConfig(FastApiFrontEndConfig, name="agent_host"):
    db_url: str = Field(
        default="sqlite+aiosqlite:///./jobs.db",
        description="Database URL for job store and event store",
    )
    expiry_seconds: int = Field(
        default=86400,
        ge=600,
        le=604800,
        description="Job expiry time in seconds (default: 24 hours)",
    )
    workflow: FastApiFrontEndConfig.EndpointBase = FastApiFrontEndConfig().workflow.model_copy(
        update=dict.fromkeys(WORKFLOW_ROUTE_FIELDS)
    )
    evaluate: FastApiFrontEndConfig.EndpointBase = FastApiFrontEndConfig().evaluate.model_copy(update={"path": None})
    step_adaptor: StepAdaptorConfig = StepAdaptorConfig(mode=StepAdaptorMode.OFF)

    @model_validator(mode="after")
    def _the_chat_socket_is_the_only_turn_route(self) -> AgentHostConfig:
        served = [f"workflow.{name}" for name in WORKFLOW_ROUTE_FIELDS if getattr(self.workflow, name)]
        served += ["evaluate.path"] if self.evaluate.path else []
        served += [f"endpoints[{endpoint.function_name}]" for endpoint in self.endpoints]
        if served:
            raise ValueError(
                f"agent_host serves a turn over its own chat socket only (ADR-0068); leave {', '.join(served)} unset"
            )
        return self


_shutdown_signal_received = False


async def drain_owned_work(role: WebRole) -> None:
    if role is WebRole.CHAT:
        await drain_chat_turns()
    else:
        logger.info("Shutting down SSE connections...")
        await get_connection_manager().shutdown(timeout=5.0)
    await EventStore.dispose_all_engines_async()
    logger.info("Shutdown complete (%s)", role.value)


def _create_shutdown_signal_handler(
    original_handler: Callable | signal.Handlers | None,
    sig: signal.Signals,
) -> Callable:

    def handler(signum, frame):
        global _shutdown_signal_received

        if _shutdown_signal_received:
            logger.warning("Second %s received, forcing exit...", sig.name)
            os._exit(1)

        _shutdown_signal_received = True
        logger.info("Signal %s received, signaling SSE shutdown... (press again to force quit)", sig.name)
        connection_manager = get_connection_manager()

        connection_manager.signal_shutdown()

        if original_handler and callable(original_handler):
            original_handler(signum, frame)
        elif original_handler == signal.SIG_DFL:
            signal.signal(sig, signal.SIG_DFL)
            signal.raise_signal(sig)

    return handler


CHAT_ROUTERS: tuple[Callable[[APIRouter], None], ...] = (add_chat_occupancy_routes,)

API_APP_REGISTRARS = (register_job_routes,)


_INTERNAL_SERVICE_ROUTERS: tuple[Callable[[APIRouter], None], ...] = (
    add_internal_tool_routes,
    add_knowledge_mark_routes,
    add_mail_archive_routes,
    add_mail_routes,
    add_drawing_rendition_routes,
    add_public_source_capture_routes,
)


def api_routers(llm_configs: Mapping[str, Any]) -> tuple[Callable[[APIRouter], None], ...]:
    return (
        add_collection_routes,
        add_document_routes,
        add_revision_compare_routes,
        add_document_search_routes,
        add_project_facts_routes,
        add_similar_passages_routes,
        add_generate_summary_routes,
        add_cleanup_proposal_routes,
        add_filing_fit_routes,
        add_folder_proposals_routes,
        add_generate_conversation_title_routes,
        add_dictation_routes,
        add_consistency_check_routes,
        add_feedback_digest_routes,
        add_lesson_distill_routes,
        add_note_embedding_routes,
        add_project_experience_routes,
        add_ingest_routes,
        *_INTERNAL_SERVICE_ROUTERS,
        add_oib_routes,
        add_norm_routes,
        add_ris_routes,
        add_maintenance_routes,
        add_draft_routes,
        add_skill_routes,
        add_skill_review_routes,
        functools.partial(add_config_info_routes, llm_configs=llm_configs),
        add_card_catalog_routes,
    )


def _add_request_middleware(app: FastAPI, *, validators: list, require_auth: bool, role: WebRole) -> None:
    app.add_middleware(RequestContextEnvelopeMiddleware, require_auth=require_auth, validators=validators)
    app.add_middleware(AuthMiddleware, validators=validators, require_auth=require_auth)
    app.add_middleware(LegacyHeaderNamesMiddleware)
    app.add_middleware(InFlightMiddleware, role=role.value)


class AgentHostWorker(FastApiFrontEndPluginWorker):
    _original_sigint_handler: Callable | signal.Handlers | None = None
    _original_sigterm_handler: Callable | signal.Handlers | None = None

    def __init__(self, config: Config):
        self._role = web_role()
        super().__init__(config)

    @override
    def build_app(self) -> FastAPI:
        from agent.common.logging_utils import suppress_noisy_dependency_logs
        from agent.common.nat_step_repair import install_step_stack_repair

        suppress_noisy_dependency_logs()
        install_step_stack_repair()

        log_boot_line()
        logger.info("Web role: %s", self._role.value)

        require_direct_dsns(listen=self._role is WebRole.API)
        assert_no_latent_vendor()
        assert_residency()  # no model call outside the cell's zone (ADR-0167)

        app = super().build_app()

        if self._role is WebRole.API:
            app.title = "AI-Q API"
            app.description = "Async research jobs, knowledge management, and agent orchestration."
        else:
            app.title = "AI-Q Chat"
            app.description = "The chat socket and the answers running on it."
        app.version = "1.0.0"

        router = APIRouter()
        for add_router_routes in api_routers(self.config.llms) if self._role is WebRole.API else CHAT_ROUTERS:
            add_router_routes(router)
        app.include_router(router)
        logger.info("%s routes registered", self._role.value)

        require_auth = os.getenv("REQUIRE_AUTH", "false").lower() == "true"
        validators = _validators + _load_validators_from_entry_points()
        if require_auth and not validators:
            raise RuntimeError(
                "REQUIRE_AUTH=true but no validators have been registered. "
                "Either call agent_host.plugin.register_validator() before starting the server, "
                "or declare an 'agent_host.validators' entry point in your package."
            )
        _add_request_middleware(app, validators=validators, require_auth=require_auth, role=self._role)
        if self._role is WebRole.CHAT:
            configure_websocket_auth(validators=validators, require_auth=require_auth)
        logger.info(
            "AuthMiddleware registered (require_auth=%s, validators=%s)",
            require_auth,
            [type(v).__name__ for v in validators],
        )

        return app

    @override
    async def add_default_route(self, app: FastAPI, session_manager: SessionManager): ...

    @override
    async def add_routes(self, app: FastAPI, builder: WorkflowBuilder):
        if self._role is WebRole.CHAT:
            await self._add_chat_routes(app, builder)
        else:
            await self._add_api_routes(app, builder)

        install_health_route(app, self._role)

        install_presigned_url_scrubbing()

        posthog_exceptions.install()

        from agent.observability import boot_timing

        boot_timing.BootClock(self._role.value).ready()
        boot_timing.flush()

        self._schedule_internal_api_check()

        self._install_signal_handlers()

        @app.on_event("shutdown")
        async def drain_role():
            await drain_owned_work(self._role)
            self._restore_signal_handlers()

    async def _add_chat_routes(self, app: FastAPI, builder: WorkflowBuilder) -> None:
        await super().add_routes(app, builder)

        session_manager = await self._create_chat_session_manager(builder)
        app.add_api_websocket_route(CHAT_SOCKET_PATH, chat_socket_endpoint(session_manager))

    async def _add_api_routes(self, app: FastAPI, builder: WorkflowBuilder) -> None:
        for register in API_APP_REGISTRARS:
            await register(app, builder, self)
        logger.info("Async Job API routes registered")

    async def _create_chat_session_manager(self, builder: WorkflowBuilder) -> SessionManager:
        session_manager = await SessionManager.create(config=self._config, shared_builder=builder, max_concurrency=0)
        self._session_managers.append(session_manager)
        return session_manager

    def _schedule_internal_api_check(self):

        async def _run() -> None:
            try:
                from agent.knowledge.project_memory import check_internal_api

                await asyncio.to_thread(check_internal_api)
            except Exception as e:  # noqa: BLE001 — diagnostic only, must not crash startup
                logger.warning("Internal API startup handshake could not run: %s", e)

        try:
            asyncio.get_running_loop().create_task(_run())
        except RuntimeError:
            logger.debug("No running loop for the internal API handshake; skipping")

    def _install_signal_handlers(self):
        try:
            self._original_sigint_handler = signal.getsignal(signal.SIGINT)
            self._original_sigterm_handler = signal.getsignal(signal.SIGTERM)

            signal.signal(
                signal.SIGINT,
                _create_shutdown_signal_handler(self._original_sigint_handler, signal.SIGINT),
            )
            signal.signal(
                signal.SIGTERM,
                _create_shutdown_signal_handler(self._original_sigterm_handler, signal.SIGTERM),
            )
            logger.debug("Installed SSE shutdown signal handlers")
        except Exception as e:
            logger.warning("Failed to install signal handlers: %s", e)

    def _restore_signal_handlers(self):
        try:
            if self._original_sigint_handler is not None:
                signal.signal(signal.SIGINT, self._original_sigint_handler)
            if self._original_sigterm_handler is not None:
                signal.signal(signal.SIGTERM, self._original_sigterm_handler)
            logger.debug("Restored original signal handlers")
        except Exception as e:
            logger.warning("Failed to restore signal handlers: %s", e)


class AgentHostPlugin(FastApiFrontEndPlugin):
    def __init__(self, full_config: Config, config: AgentHostConfig):
        super().__init__(full_config=full_config)
        self.config = config

    @override
    def get_worker_class(self) -> type[FastApiFrontEndPluginWorkerBase]:
        return AgentHostWorker


@register_front_end(config_type=AgentHostConfig)
async def register_agent_host(config: AgentHostConfig, full_config: Config):
    yield AgentHostPlugin(full_config=full_config, config=config)
