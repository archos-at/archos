from __future__ import annotations

import argparse
import logging
import os
import sys
from collections.abc import Mapping
from pathlib import Path

from knowledge_layer.vector_store import Export
from knowledge_layer.vector_store import InvalidExport
from knowledge_layer.vector_store import QdrantStore
from knowledge_layer.vector_store import ScopeReport
from knowledge_layer.vector_store import expected_ids
from knowledge_layer.vector_store import identity_refusals
from knowledge_layer.vector_store import import_scope
from knowledge_layer.vector_store import ingested_since_export
from knowledge_layer.vector_store import make_client
from knowledge_layer.vector_store import orphan_scopes
from knowledge_layer.vector_store import prune_scope
from knowledge_layer.vector_store import qdrant_scopes
from knowledge_layer.vector_store import record_import
from knowledge_layer.vector_store import recorded_import
from knowledge_layer.vector_store import verify_scope

logger = logging.getLogger("import_vectors")


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Load a vector export into Qdrant, without re-embedding (ADR-0115).")
    parser.add_argument("--in", dest="export", type=Path, required=True, help="The export directory.")
    parser.add_argument("--collection", action="append", help="Only this collection (repeatable).")
    parser.add_argument("--dry-run", action="store_true", help="Read and check the export; write nothing.")
    parser.add_argument("--prune", action="store_true", help="Delete Qdrant points and scopes the export lacks.")
    parser.add_argument("--verify", action="store_true", help="Compare chunk ids per collection; exit 1 on a gap.")
    parser.add_argument("--verify-only", action="store_true", help="Only compare; import nothing.")
    parser.add_argument(
        "--force", action="store_true", help="Write although an earlier import into this Qdrant already verified."
    )
    args = parser.parse_args(argv)
    args.verify = args.verify or args.verify_only
    return args


def _configured_identity() -> dict[str, str]:
    from knowledge_layer.embedding import embed_fingerprint_metadata

    return embed_fingerprint_metadata(
        os.environ.get("EMBED_MODEL", "openai/text-embedding-3-large"),
        os.environ.get("EMBED_BASE_URL", "https://openrouter.ai/api/v1"),
    )


def _run_one(
    export: Export, store: QdrantStore, name: str, identity: Mapping[str, str], args: argparse.Namespace
) -> ScopeReport:
    scoped = QdrantStore(store.client, identity)
    if args.verify_only:
        newer = ingested_since_export(export, name, scoped)
        report, ids = ScopeReport(name), expected_ids(export, name, export.id_set(name), newer)
    else:
        report, ids = import_scope(export, name, scoped, dry_run=args.dry_run)
    if args.prune:
        report.pruned = prune_scope(ids, name, scoped, dry_run=args.dry_run)
    if args.verify:
        verification = verify_scope(ids, name, scoped)
        report.export_count, report.qdrant_count = verification.export_count, verification.qdrant_count
        report.missing, report.extra, report.sampled = verification.missing, verification.extra, verification.sampled
    return report


def _orphans(store: QdrantStore, scopes: list[str], names: list[str], args: argparse.Namespace) -> list[ScopeReport]:
    reports = []
    for scope in orphan_scopes(names, scopes):
        report = ScopeReport(scope, export_count=0, qdrant_count=store.count(scope))
        if args.prune:
            report.pruned = report.qdrant_count
            if not args.dry_run:
                store.delete_scope(scope)
                report.qdrant_count = store.count(scope)
        reports.append(report)
    return reports


def _log(report: ScopeReport, gap: bool) -> None:
    logger.info(
        "%s %s: read=%d written=%d pruned=%d export=%s qdrant=%s missing=%d extra=%d%s",
        "[gap]" if gap else "[ok]",
        report.scope,
        report.read,
        report.written,
        report.pruned,
        report.export_count,
        report.qdrant_count,
        report.missing,
        report.extra,
        " (sampled)" if report.sampled else "",
    )


def _open(args: argparse.Namespace) -> tuple[Export, list[str]]:
    export = Export.open(args.export)
    names = sorted(set(args.collection)) if args.collection else sorted(export.collections)
    unknown = [name for name in names if name not in export.collections]
    if unknown:
        raise InvalidExport(f"the export holds no collection {', '.join(unknown)}")
    return export, names


def _fallback_identity(export: Export, names: list[str]) -> dict[str, str] | None:
    if all(export.collections[name].has_identity for name in names):
        return None
    return _configured_identity()


def _refused(store: QdrantStore, export: Export, names: list[str], fallback: Mapping[str, str] | None) -> bool:
    refusals = identity_refusals(store, export, names, fallback)
    for name, reason in refusals.items():
        logger.error("[refused] %s: %s", name, reason)
    return bool(refusals)


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-8s %(message)s", stream=sys.stdout)
    logging.getLogger("httpx").setLevel(logging.WARNING)  # one line per Qdrant request otherwise
    args = _parse_args(argv)
    try:
        export, names = _open(args)
    except InvalidExport as exc:
        logger.error("Invalid export: %s", exc)
        return 2
    try:
        client = make_client()
        client.get_aliases()
        store = QdrantStore(client)
        scopes = [] if args.collection else qdrant_scopes(store)
    except Exception as exc:  # noqa: BLE001 - an unreachable Qdrant is the same hard stop whatever the cause
        logger.error("Could not reach Qdrant: %s", exc)
        return 2
    fallback = _fallback_identity(export, names)
    if _refused(store, export, names, fallback):
        logger.error("Nothing written: the export's embedder does not match Qdrant's")
        return 2
    if _already_imported(store, args):
        return 2
    logger.info("Export of %s (Chroma %s): %d collection(s)", export.created_at, export.chroma_version, len(names))

    failed = invalid = 0
    for name in names:
        try:
            report = _run_one(export, store, name, export.collections[name].identity(fallback), args)
        except InvalidExport as exc:
            invalid += 1
            logger.error("[invalid] %s: %s", name, exc)
            continue
        except Exception as exc:  # noqa: BLE001 - one collection failing never stops the rest
            failed += 1
            logger.error("[fail] %s: %s", name, exc)
            continue
        gap = args.verify and not report.in_step
        failed += int(gap)
        _log(report, gap)
    failed += _report_orphans(store, scopes, names, args)
    logger.info(
        "Done: %d collection(s), %d failed or out of step, %d invalid%s",
        len(names),
        failed,
        invalid,
        " (dry run)" * args.dry_run,
    )
    code = 2 if invalid else 1 if failed else 0
    _record_if_complete(store, export, args, code)
    return code


def _writes(args: argparse.Namespace) -> bool:
    return not (args.dry_run or args.verify_only)


def _already_imported(store: QdrantStore, args: argparse.Namespace) -> bool:
    if not _writes(args) or args.force:
        return False
    marker = recorded_import(store)
    if marker is None:
        return False
    logger.error(
        "[refused] an import already verified into this Qdrant (%s). Importing again brings back the chunks "
        "of every document deleted since. Nothing written; pass --force to import anyway",
        marker,
    )
    return True


def _record_if_complete(store: QdrantStore, export: Export, args: argparse.Namespace, code: int) -> None:
    if code != 0 or not args.verify or not _writes(args) or args.collection:
        return
    record_import(store, export)
    logger.info("Recorded the import in the Qdrant collections: a later run that writes needs --force")


def _report_orphans(store: QdrantStore, scopes: list[str], names: list[str], args: argparse.Namespace) -> int:
    try:
        orphans = _orphans(store, scopes, names, args)
    except Exception as exc:  # noqa: BLE001 - reported like a failed collection
        logger.error("[fail] scopes only Qdrant holds: %s", exc)
        return 1
    failed = 0
    for report in orphans:
        gap = args.verify and bool(report.qdrant_count)
        failed += int(gap)
        _log(report, gap)
    return failed


if __name__ == "__main__":
    sys.exit(main())
