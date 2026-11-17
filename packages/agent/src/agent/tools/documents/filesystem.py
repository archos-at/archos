from __future__ import annotations

import logging
from collections.abc import Awaitable
from collections.abc import Callable
from typing import Any
from typing import Literal

from deepagents.backends import CompositeBackend
from deepagents.backends.protocol import BackendProtocol
from deepagents.backends.protocol import EditResult
from deepagents.backends.protocol import GlobResult
from deepagents.backends.protocol import GrepResult
from deepagents.backends.protocol import LsResult
from deepagents.backends.protocol import ReadResult
from deepagents.backends.protocol import WriteResult
from deepagents.middleware.filesystem import FilesystemMiddleware
from langchain.tools import ToolRuntime
from langchain_core.messages import ToolMessage
from langchain_core.tools import BaseTool
from langchain_core.tools import StructuredTool
from pydantic import BaseModel
from pydantic import Field

from agent.common.citation_collector import artifact_for
from agent.common.citation_collector import collect_citations
from agent.common.estate_paths import is_draft_path
from agent.common.estate_paths import is_skill_path
from agent.common.tool_calls import CONCLUSION_DESCRIPTION
from agent.skills import SKILLS_ROOT

from .draft_store import DRAFT_ROOT
from .draft_store import DraftBackend
from .draft_store import modernize_draft_path

logger = logging.getLogger(__name__)

NO_DRAFTS = "This turn has no working directory: /drafts/ exists only in a conversation."


class _DraftRoute(BackendProtocol):
    def __init__(self, drafts: DraftBackend) -> None:
        self.drafts = drafts
        self._root = DRAFT_ROOT.rstrip("/")

    def _full(self, path: str | None) -> str:
        rest = (path or "/").lstrip("/")
        return f"{self._root}/{rest}" if rest else DRAFT_ROOT

    def _local(self, path: str) -> str:
        return path[len(self._root) :] if path.startswith(self._root + "/") else path

    def _ls(self, result: LsResult) -> LsResult:
        if result.error or not result.entries:
            return result
        return LsResult(entries=[{**entry, "path": self._local(entry["path"])} for entry in result.entries])

    def _glob(self, result: GlobResult) -> GlobResult:
        if result.error or not result.matches:
            return result
        return GlobResult(
            matches=[{**entry, "path": self._local(entry["path"])} for entry in result.matches],
            truncated=result.truncated,
        )

    def _grep(self, result: GrepResult) -> GrepResult:
        if result.error or not result.matches:
            return result
        return GrepResult(
            matches=[{**match, "path": self._local(match["path"])} for match in result.matches],
            truncated=result.truncated,
        )

    def ls(self, path: str) -> LsResult:
        return self._ls(self.drafts.ls(self._full(path)))

    async def als(self, path: str) -> LsResult:
        return self._ls(await self.drafts.als(self._full(path)))

    def read(self, file_path: str, offset: int = 0, limit: int = 2000) -> ReadResult:
        return self.drafts.read(self._full(file_path), offset=offset, limit=limit)

    async def aread(self, file_path: str, offset: int = 0, limit: int = 2000) -> ReadResult:
        return await self.drafts.aread(self._full(file_path), offset=offset, limit=limit)

    def write(self, file_path: str, content: str) -> WriteResult:
        return self.drafts.write(self._full(file_path), content)

    async def awrite(self, file_path: str, content: str) -> WriteResult:
        return await self.drafts.awrite(self._full(file_path), content)

    def edit(self, file_path: str, old_string: str, new_string: str, replace_all: bool = False) -> EditResult:  # noqa: FBT001, FBT002
        return self.drafts.edit(self._full(file_path), old_string, new_string, replace_all)

    async def aedit(
        self,
        file_path: str,
        old_string: str,
        new_string: str,
        replace_all: bool = False,  # noqa: FBT001, FBT002 - positional, to match the backend protocol
    ) -> EditResult:
        return await self.drafts.aedit(self._full(file_path), old_string, new_string, replace_all)

    def glob(self, pattern: str, path: str | None = None) -> GlobResult:
        return self._glob(self.drafts.glob(pattern, self._full(path)))

    async def aglob(self, pattern: str, path: str | None = None) -> GlobResult:
        return self._glob(await self.drafts.aglob(pattern, self._full(path)))

    def grep(
        self, pattern: str, path: str | None = None, glob: str | None = None, *, max_count: int | None = None
    ) -> GrepResult:
        return self._grep(self.drafts.grep(pattern, self._full(path), glob, max_count=max_count))

    async def agrep(
        self, pattern: str, path: str | None = None, glob: str | None = None, *, max_count: int | None = None
    ) -> GrepResult:
        return self._grep(await self.drafts.agrep(pattern, self._full(path), glob, max_count=max_count))


class _NoEstate(BackendProtocol):
    async def als(self, path: str) -> LsResult:
        return LsResult(entries=[])

    async def aread(self, file_path: str, offset: int = 0, limit: int = 2000) -> ReadResult:
        return ReadResult(error="file_not_found")

    async def awrite(self, file_path: str, content: str) -> WriteResult:
        return WriteResult(error=f"{file_path} is outside {DRAFT_ROOT} (permission denied)")

    async def aedit(self, file_path: str, old_string: str, new_string: str, replace_all: bool = False) -> EditResult:  # noqa: FBT001, FBT002
        return EditResult(error=f"{file_path} is outside {DRAFT_ROOT} (permission denied)")


def composite_backend(
    drafts: DraftBackend | None, estate: BackendProtocol | None, *, skills: BackendProtocol | None = None
) -> CompositeBackend:
    routes: dict[str, BackendProtocol] = {DRAFT_ROOT: _DraftRoute(drafts)} if drafts is not None else {}
    if skills is not None:
        routes[SKILLS_ROOT] = skills
    return CompositeBackend(default=estate or _NoEstate(), routes=routes, artifacts_root=DRAFT_ROOT)


def _off_the_estate(path: str | None) -> bool:
    return path is not None and (is_draft_path(path) or is_skill_path(path))


class EstateReadFileSchema(BaseModel):
    file_path: str
    pages: str | int | None = None
    clause: str | None = None
    offset: int = 0
    limit: int = 100
    conclusion: str = Field(default="", description=CONCLUSION_DESCRIPTION)


EstateCall = Callable[[], Awaitable[Any]]


async def estate_message(name: str, runtime: ToolRuntime, call: EstateCall) -> ToolMessage:
    with collect_citations() as collected:
        output = await call()
    return ToolMessage(
        content=output.text,
        name=name,
        tool_call_id=runtime.tool_call_id,
        status="error" if output.status == "error" else "success",
        artifact=artifact_for(collected),
    )


class DocumentFilesystem(FilesystemMiddleware):
    def __init__(self, *, estate: Any = None, drafts: bool = True, **kwargs: Any) -> None:
        self._estate = estate
        self._has_drafts = drafts
        super().__init__(**kwargs)

    @property
    def name(self) -> str:
        return "FilesystemMiddleware"

    def _create_read_file_tool(self) -> BaseTool:
        stock = super()._create_read_file_tool()
        if self._estate is None:
            return stock
        estate = self._estate
        has_drafts = self._has_drafts

        async def read_file(
            file_path: str,
            runtime: ToolRuntime,
            offset: int = 0,
            limit: int = 100,
            pages: str | int | None = None,
            clause: str | None = None,
            conclusion: str = "",  # noqa: ARG001 - read off the call by the Herleitung, never by the read
        ) -> ToolMessage | Any:
            if _off_the_estate(file_path):
                if not has_drafts and is_draft_path(file_path):
                    return _refusal("read_file", runtime, NO_DRAFTS)
                return await stock.coroutine(
                    file_path=modernize_draft_path(file_path), runtime=runtime, offset=offset, limit=limit
                )
            return await estate_message(
                "read_file",
                runtime,
                lambda: estate.read_file(file_path, pages=pages, clause=clause, offset=offset, limit=limit),
            )

        return StructuredTool.from_function(
            name="read_file",
            coroutine=read_file,
            args_schema=EstateReadFileSchema,
            infer_schema=False,
            description=self._custom_tool_descriptions.get("read_file") or stock.description,
        )

    def _create_ls_tool(self) -> BaseTool:
        stock = super()._create_ls_tool()
        if self._estate is None:
            return stock
        estate = self._estate
        has_drafts = self._has_drafts

        async def ls(path: str, runtime: ToolRuntime, depth: int = 1) -> ToolMessage | Any:
            if _off_the_estate(path):
                if not has_drafts and is_draft_path(path):
                    return _refusal("ls", runtime, NO_DRAFTS)
                return await stock.coroutine(path=modernize_draft_path(path), runtime=runtime)
            return await estate_message("ls", runtime, lambda: estate.ls(path, depth=depth, drafts=has_drafts))

        return StructuredTool.from_function(
            name="ls",
            coroutine=ls,
            args_schema=EstateLsSchema,
            infer_schema=False,
            description=self._custom_tool_descriptions.get("ls") or stock.description,
        )

    def _create_glob_tool(self) -> BaseTool:
        stock = super()._create_glob_tool()
        if self._estate is None:
            return stock
        estate = self._estate
        has_drafts = self._has_drafts

        async def glob(pattern: str, runtime: ToolRuntime, path: str | None = None) -> ToolMessage | Any:
            if _off_the_estate(path):
                if not has_drafts and is_draft_path(path):
                    return _refusal("glob", runtime, NO_DRAFTS)
                return await stock.coroutine(pattern=pattern, path=modernize_draft_path(path), runtime=runtime)
            return await estate_message("glob", runtime, lambda: estate.glob(pattern, path))

        return StructuredTool.from_function(
            name="glob",
            coroutine=glob,
            args_schema=EstateGlobSchema,
            infer_schema=False,
            description=self._custom_tool_descriptions.get("glob") or stock.description,
        )

    def _create_grep_tool(self) -> BaseTool:
        stock = super()._create_grep_tool()
        if self._estate is None:
            return stock
        estate = self._estate
        has_drafts = self._has_drafts

        async def grep(
            pattern: str,
            runtime: ToolRuntime,
            path: str | None = None,
            glob: str | None = None,
            output_mode: str = "files_with_matches",
            max_count: int | None = None,
            mode: str = "exact",
            stemmed: bool = False,
            context: int = 0,
            conclusion: str = "",  # noqa: ARG001 - read off the call by the Herleitung, never by the search
        ) -> ToolMessage | Any:
            if _off_the_estate(path):
                if not has_drafts and is_draft_path(path):
                    return _refusal("grep", runtime, NO_DRAFTS)
                return await stock.coroutine(
                    pattern=pattern,
                    runtime=runtime,
                    path=modernize_draft_path(path),
                    glob=glob,
                    output_mode=output_mode,
                    max_count=max_count,
                )
            return await estate_message(
                "grep",
                runtime,
                lambda: estate.grep(
                    pattern,
                    path=path,
                    glob=glob,
                    output_mode=output_mode,
                    max_count=max_count,
                    mode=mode,
                    stemmed=stemmed,
                    context=context,
                ),
            )

        return StructuredTool.from_function(
            name="grep",
            coroutine=grep,
            args_schema=EstateGrepSchema,
            infer_schema=False,
            description=self._custom_tool_descriptions.get("grep") or stock.description,
        )


class EstateGrepSchema(BaseModel):
    pattern: str
    path: str | None = None
    glob: str | None = None
    output_mode: Literal["files_with_matches", "content", "count"] = "files_with_matches"
    max_count: int | None = Field(default=None, gt=0)
    mode: Literal["exact", "regex"] = "exact"
    stemmed: bool = False
    context: int = Field(default=0, ge=0, le=3)
    conclusion: str = Field(default="", description=CONCLUSION_DESCRIPTION)


class EstateLsSchema(BaseModel):
    path: str
    depth: int = Field(default=1, ge=1, le=4)


class EstateGlobSchema(BaseModel):
    pattern: str
    path: str | None = None


class DraftWriteSchema(BaseModel):
    file_path: str
    content: str


class DraftEditSchema(BaseModel):
    file_path: str
    old_string: str
    new_string: str
    replace_all: bool = False


BARE_STOCK_SCHEMAS: dict[str, type[BaseModel]] = {"write_file": DraftWriteSchema, "edit_file": DraftEditSchema}


def with_bare_schema(tool: BaseTool) -> BaseTool:
    bare = BARE_STOCK_SCHEMAS.get(tool.name)
    return tool.model_copy(update={"args_schema": bare}) if bare is not None else tool


def _refusal(name: str, runtime: ToolRuntime, text: str) -> ToolMessage:
    return ToolMessage(content=text, name=name, tool_call_id=runtime.tool_call_id, status="error")
