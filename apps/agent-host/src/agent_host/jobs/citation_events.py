from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from agent.citations.entries import SourceEntry
from agent.citations.extraction import extract_sources_from_tool_result
from agent.citations.registry import SourceRegistry
from agent.citations.session import get_session_registry
from agent.citations.verification import cited_document_entries
from agent.citations.wire import source_entry_to_wire

from .step_events import ArtifactType

logger = logging.getLogger(__name__)


class CitationEvents:
    def set_source_registry(self, source_registry: SourceRegistry | Callable[[], SourceRegistry | None]) -> None:
        self._source_registry = source_registry

    def set_source_exclusion(self, excluded: Callable[[SourceEntry], bool]) -> None:
        self._source_excluded = excluded

    def _get_source_registry(self) -> SourceRegistry | None:
        provider = self._source_registry
        if provider is not None:
            registry: SourceRegistry | None
            try:
                registry = provider() if callable(provider) else provider
            except Exception:
                logger.warning("Attached source registry provider raised; falling back", exc_info=True)
                registry = None
            if registry is not None:
                return registry

        session_registry = get_session_registry()
        if session_registry is not None:
            return session_registry

        return self._mirrored_registry if self._mirrored_registry_populated else None

    def _mirror_sources(self, entries: list[SourceEntry]) -> None:
        if not entries:
            return
        try:
            with self._cache_lock:
                self._add_mirrored(entries)
        except Exception:
            logger.warning("Failed to mirror tool sources into the fallback registry", exc_info=True)

    def _add_mirrored(self, entries: list[SourceEntry]) -> None:
        for entry in entries:
            self._mirrored_registry.add(entry)
        self._mirrored_registry_populated = True

    def _is_search_tool(self, tool_name: str) -> bool:
        tool_lower = tool_name.lower()
        return any(pattern in tool_lower for pattern in self.SEARCH_TOOL_PATTERNS)

    def _normalize_url(self, url: str) -> str:
        from urllib.parse import urlparse
        from urllib.parse import urlunparse

        try:
            parsed = urlparse(url)
            normalized_path = parsed.path.rstrip("/") if parsed.path != "/" else "/"
            normalized = urlunparse(
                (
                    parsed.scheme.lower(),
                    parsed.netloc.lower(),
                    normalized_path,
                    parsed.params,
                    parsed.query,
                    "",  # Remove fragment
                )
            )
            return normalized
        except Exception:
            return url

    def _extract_urls(self, text: str) -> list[str]:
        if not text:
            return []
        urls = self.URL_PATTERN.findall(str(text))
        cleaned = []
        for url in urls:
            url = url.rstrip(".,;:!?)'\"]}>)")
            if len(url) > 10 and "." in url:
                cleaned.append(url)
        return list(dict.fromkeys(cleaned))

    def _emit_cited_sources(self, content: str) -> None:
        self._emit_cited_urls(content)
        self._emit_cited_documents(content)

    def _emit_cited_urls(self, content: str) -> None:
        urls = self._extract_urls(content)
        registry = self._get_source_registry()
        for url in urls:
            normalized = self._normalize_url(url)

            if registry is not None:
                is_valid = registry.has_url(url)
            else:
                is_valid = normalized in self._discovered_urls

            if not is_valid or not self._claim_cited(normalized):
                continue
            self._emit_artifact(
                ArtifactType.CITATION_USE,
                url,
                name=url,
                url=url,
            )

    def _claim_cited(self, identity: str) -> bool:
        with self._cache_lock:
            if identity in self._cited_urls:
                return False
            self._cited_urls.add(identity)
        return True

    def _emit_cited_documents(self, content: str) -> None:
        registry = self._get_source_registry()
        if registry is None:
            return
        try:
            entries = cited_document_entries(content, registry)
        except Exception:
            logger.warning("Failed to resolve cited documents", exc_info=True)
            return

        for entry in entries:
            wire = source_entry_to_wire(entry)
            identity = self._source_identity(wire)
            if not self._claim_cited(identity):
                continue
            content_line = str(wire.get("content") or entry.citation_key or "")
            extra = {key: value for key, value in wire.items() if key != "content"}
            self._emit_artifact(
                ArtifactType.CITATION_USE,
                content_line,
                name=str(wire.get("title") or entry.citation_key or content_line),
                **extra,
            )

    def _source_identity(self, wire: dict[str, Any]) -> str:
        citation_key = wire.get("citation_key")
        if isinstance(citation_key, str) and citation_key.strip():
            return f"key:{citation_key.strip().lower()}"
        url = wire.get("url")
        if isinstance(url, str) and url.strip():
            return f"url:{self._normalize_url(url)}"
        file_name = wire.get("file_name")
        if isinstance(file_name, str) and file_name.strip():
            page = wire.get("page")
            return f"file:{file_name.strip().lower()}:{page if page is not None else ''}"
        content = wire.get("content")
        if isinstance(content, str) and content.strip():
            return f"content:{content.strip().lower()[:200]}"
        return f"tool:{wire.get('tool') or 'unknown'}"

    def _emit_structured_citation_sources(
        self,
        tool_name: str,
        output: str,
        *,
        agent_id: str | None,
        workflow: str | None,
    ) -> None:
        try:
            entries = extract_sources_from_tool_result(tool_name, output)
        except Exception:
            logger.warning("Failed to extract sources from tool %s", tool_name, exc_info=True)
            entries = []

        useful = [
            entry for entry in entries if entry.url or entry.citation_key or (entry.source_type == "knowledge_layer")
        ]

        if not useful and self._is_search_tool(tool_name):
            useful.extend(
                SourceEntry(url=url, source_type="generic", tool_name=tool_name) for url in self._extract_urls(output)
            )
        if self._source_excluded is not None:
            useful = [entry for entry in useful if not self._source_excluded(entry)]

        self._mirror_sources(useful)

        for entry in useful:
            wire = source_entry_to_wire(entry)
            if not wire.get("tool"):
                wire["tool"] = tool_name
            identity = self._source_identity(wire)

            if not self._claim_discovered(identity, entry.url):
                continue

            content = str(wire.get("content") or entry.url or entry.citation_key or tool_name)
            name = str(wire.get("title") or wire.get("citation_key") or entry.url or content)
            extra = {key: value for key, value in wire.items() if key != "content"}
            self._emit_artifact(
                ArtifactType.CITATION_SOURCE,
                content,
                name=name,
                agent_id=agent_id,
                workflow=workflow,
                **extra,
            )

    def _claim_discovered(self, identity: str, url: str | None) -> bool:
        with self._cache_lock:
            if identity in self._discovered_sources:
                return False
            self._discovered_sources.add(identity)
            if url:
                self._discovered_urls.add(self._normalize_url(url))
        return True
