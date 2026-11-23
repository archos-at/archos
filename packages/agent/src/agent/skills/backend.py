from __future__ import annotations

from collections.abc import Callable
from collections.abc import Mapping
from collections.abc import Sequence
from difflib import get_close_matches
from typing import Any

import yaml
from deepagents.backends import StateBackend
from deepagents.backends.protocol import DeleteResult
from deepagents.backends.protocol import EditResult
from deepagents.backends.protocol import FileUploadResponse
from deepagents.backends.protocol import ReadResult
from deepagents.backends.protocol import WriteResult
from deepagents.backends.utils import create_file_data
from deepagents.backends.utils import slice_read_response

from .legacy_names import skill_name_family
from .models import Skill

SKILLS_ROOT = "/skills/"

OFFICE_SOURCE = "office"

_READ_ONLY = "the skills mount is read-only"

_LIST_ALL_UNDER = 12
_CLOSEST = 3


def skill_document(skill: Skill) -> str:
    front: dict[str, Any] = {"name": skill.name, "description": skill.description}
    if skill.license:
        front["license"] = skill.license
    if skill.compatibility:
        front["compatibility"] = skill.compatibility
    if skill.allowed_tools:
        front["allowed-tools"] = skill.allowed_tools
    if skill.metadata:
        front["metadata"] = dict(skill.metadata)
    head = yaml.safe_dump(front, allow_unicode=True, sort_keys=False, width=10_000)
    return f"---\n{head}---\n\n{skill.body.strip()}\n"


def skill_path(source: str, name: str) -> str:
    return f"/{source}/{name}/SKILL.md"


class SkillsBackend(StateBackend):
    def __init__(
        self,
        sources: Mapping[str, Sequence[Skill]],
        *,
        on_read: Callable[[Skill], None] | None = None,
        read_suffix: Callable[[Skill], str | None] | None = None,
    ) -> None:
        super().__init__()
        self._skills = {skill_path(source, s.name): s for source, skills in sources.items() for s in skills}
        aliases = {
            skill_path(source, alias): skill_path(source, s.name)
            for source, skills in sources.items()
            for s in skills
            for alias in skill_name_family(s.name)
        }
        self._aliases = {alias: path for alias, path in aliases.items() if alias not in self._skills}
        self._files = {path: create_file_data(skill_document(s)) for path, s in self._skills.items()}
        self._on_read = on_read
        self._read_suffix = read_suffix

    def _read_files(self) -> dict[str, Any]:
        return self._files

    def _miss(self, file_path: str) -> str:
        shown = f"{SKILLS_ROOT.rstrip('/')}{file_path}"
        paths = sorted(self._skills)
        if not paths:
            return f"{shown} does not exist: no skills are offered this turn. Continue without one."
        if len(paths) > _LIST_ALL_UNDER:
            asked = file_path.rstrip("/").removesuffix("/SKILL.md").rsplit("/", 1)[-1]
            names = get_close_matches(asked, [self._skills[p].name for p in paths], n=_CLOSEST, cutoff=0.4)
            close = [p for p in paths if self._skills[p].name in names]
            if close:
                paths, intro = close, "The closest skills"
            else:
                return (
                    f"{shown} does not exist, and no skill is named like it. Read a path exactly as the "
                    "Skills section lists it, or continue without a skill."
                )
        else:
            intro = "The skills offered this turn"
        listed = ", ".join(f"{SKILLS_ROOT.rstrip('/')}{p}" for p in paths)
        return (
            f"{shown} does not exist. {intro}: {listed}. "
            "Call read_file with one of these paths, or continue without one."
        )

    def read(self, file_path: str, offset: int = 0, limit: int = 2000) -> ReadResult:
        file_path = self._aliases.get(file_path, file_path)
        skill = self._skills.get(file_path)
        if skill is None:
            result = super().read(file_path, offset=offset, limit=limit)
            return ReadResult(error=self._miss(file_path)) if result.error else result
        file_data = self._files[file_path]
        suffix = self._read_suffix(skill) if self._read_suffix else None
        if suffix:
            file_data = create_file_data(f"{file_data['content']}\n{suffix}\n")
        result = slice_read_response(file_data, offset, limit)
        if result.error is None and self._on_read is not None:
            self._on_read(skill)
        return result

    def write(self, file_path: str, content: str) -> WriteResult:  # noqa: ARG002 - the protocol's shape
        return WriteResult(error=f"Cannot write to {file_path}: {_READ_ONLY}.")

    def edit(
        self,
        file_path: str,
        old_string: str,  # noqa: ARG002 - the protocol's shape
        new_string: str,  # noqa: ARG002
        replace_all: bool = False,  # noqa: ARG002, FBT001, FBT002
    ) -> EditResult:
        return EditResult(error=f"Cannot edit {file_path}: {_READ_ONLY}.")

    def delete(self, file_path: str) -> DeleteResult:
        return DeleteResult(error=f"Cannot delete {file_path}: {_READ_ONLY}.")

    def upload_files(self, files: list[tuple[str, bytes]]) -> list[FileUploadResponse]:
        return [FileUploadResponse(path=path, error="permission_denied") for path, _ in files]
