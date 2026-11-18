from __future__ import annotations

import os

from pydantic import Field

from nat.plugin_api import Builder
from nat.plugin_api import FunctionBaseConfig
from nat.plugin_api import FunctionInfo
from nat.plugin_api import register_function

from ..documents.draft_store import DRAFT_ROOT
from .run import execute

RUNNER_URL_ENV = "CODE_RUNNER_URL"

EXECUTE_DESCRIPTION = (
    "Runs a JavaScript or TypeScript module you write in a sandbox with no network, and keeps the files it "
    "writes. Use it to make real files (Word, Excel, PowerPoint, PDF, charts) and to calculate exactly. Read "
    "the `office-files` skill first: it lists the libraries and how to write a file well. `code` is "
    "`export default async function () { … }`; its return value comes back as `value` and must be plain JSON. "
    f"{DRAFT_ROOT} is /workspace/ inside the run; `documents` named here appear read-only under "
    "/workspace/in/ (the report names each path). "
    f"Files written under /workspace/ are kept in {DRAFT_ROOT}. Errors come back on stderr: fix and run again, "
    "at most three times per file."
)


class ExecuteConfig(FunctionBaseConfig, name="execute"):
    runner_url: str | None = Field(default=None, description="The code runner's base URL; unset reads CODE_RUNNER_URL.")


@register_function(config_type=ExecuteConfig)
async def execute_tool(tool_config: ExecuteConfig, builder: Builder):
    runner_url = tool_config.runner_url or os.environ.get(RUNNER_URL_ENV, "")

    async def run_execute(code: str, documents: list[str] | None = None) -> str:
        return await execute(runner_url, code, documents=documents)

    yield FunctionInfo.from_fn(run_execute, description=EXECUTE_DESCRIPTION)
