from __future__ import annotations

import urllib.parse
from pathlib import Path
from typing import Any

from fixture_files import FilesProject
from fixture_files import FilesWorkspace
from fixture_files import FixtureFile
from fixture_files import document_id
from render_fixture_drawings import SPEC
from render_fixture_drawings import load_spec
from render_fixture_drawings import render_all

COLLECTION = "proj_visual_eval"
DESCRIPTION = "Aufstockung des Wohnhauses in der Hubergasse, Einreichpläne"
BUCKET = "fixture-visual"
KEY_PREFIX = "drawings/"
S3_ENV = {
    "SEAWEED_ACCESS_KEY": "fixture",
    "SEAWEED_SECRET_KEY": "fixture",
    "SEAWEED_BUCKET": BUCKET,
}  # pragma: allowlist secret


def load_project(spec: dict[str, Any] | None = None, path: Path = SPEC) -> FilesProject:
    spec = spec or load_spec(path)
    files = tuple(
        FixtureFile(
            name=drawing["file_name"],
            folder=drawing["folder"],
            added_at=None,
            revision_facts=None,
            pages=tuple(page["index_text"] for page in drawing["pages"]),
        )
        for drawing in spec["drawings"]
    )
    return FilesProject(COLLECTION, DESCRIPTION, files, {})


class VisualWorkspace(FilesWorkspace):

    def __init__(self, pdfs: dict[str, bytes], project: FilesProject | None = None) -> None:
        super().__init__(project or load_project())
        self.pdfs = pdfs

    @classmethod
    def rendered(cls, out: Path) -> VisualWorkspace:
        written = render_all(out)
        return cls({name: path.read_bytes() for name, path in written.items()})

    def document_file(self, query: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        name = str(query.get("filename") or "")
        if query.get("collection") != self.project.collection or name not in self.pdfs:
            return 404, {"error": "Not found"}
        return 200, {
            "documentId": document_id(self.project, name),
            "storageKey": f"{KEY_PREFIX}{name}",
            "storageBucket": BUCKET,
        }

    def object_bytes(self, path: str) -> bytes | None:
        bucket, _, key = urllib.parse.unquote(path).lstrip("/").partition("/")
        if bucket != BUCKET or not key.startswith(KEY_PREFIX):
            return None
        return self.pdfs.get(key[len(KEY_PREFIX) :])

    def env(self, bff_url: str, look: bool) -> dict[str, str]:
        return {
            **S3_ENV,
            "SEAWEED_ENDPOINT": bff_url,
            "NO_PROXY": "127.0.0.1,localhost",
            "no_proxy": "127.0.0.1,localhost",
            "VIEW_IMAGES_ENABLED": "1" if look else "0",
        }
