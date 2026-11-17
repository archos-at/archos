def retrieval_dependency_faults() -> list[tuple[str, BaseException]]:
    faults: list[tuple[str, BaseException]] = []

    def _probe(distribution: str, module: str, load) -> None:
        try:
            load()
        except ModuleNotFoundError as exc:
            missing = exc.name or ""
            if missing and (module == missing or module.startswith(f"{missing}.")):
                faults.append((f"{distribution}: not installed ({exc})", exc))
            else:
                faults.append((f"{distribution}: installed but broken (missing dependency {missing or exc!r})", exc))
        except Exception as exc:  # noqa: BLE001 - the point is to report, not to handle
            faults.append((f"{distribution}: installed but broken ({type(exc).__name__}: {exc})", exc))

    def _core() -> None:
        import llama_index.core  # noqa: F401

    def _embeddings() -> None:
        from llama_index.embeddings.nvidia import NVIDIAEmbedding  # noqa: F401

    def _vector_store() -> None:
        __import__("qdrant_client")

    _probe("llama-index-core", "llama_index.core", _core)
    _probe("llama-index-embeddings-nvidia", "llama_index.embeddings.nvidia", _embeddings)
    _probe("qdrant-client", "qdrant_client", _vector_store)
    return faults


def retrieval_dependency_report() -> list[str]:
    return [finding for finding, _ in retrieval_dependency_faults()]


def ensure_retrieval_dependencies() -> None:
    faults = retrieval_dependency_faults()
    if not faults:
        return
    raise RuntimeError(
        "LlamaIndex retrieval stack is unusable in this environment.\nModule status:\n  "
        + "\n  ".join(finding for finding, _ in faults)
        + "\nA module reported 'installed but broken' means the distribution is present but incomplete "
        "(commonly a missing llama-index-core under the llama_index namespace package) -- reinstalling "
        "the whole extra, not adding a package, is the fix: uv sync --extra llamaindex"
    ) from faults[0][1]


def retrieval_dependency_error(cause: BaseException) -> RuntimeError:
    findings = retrieval_dependency_report() or ["no per-module fault found; see the chained exception"]
    return RuntimeError(
        "LlamaIndex retrieval stack is unusable in this environment.\n"
        f"Triggering import error: {type(cause).__name__}: {cause}\n"
        "Module status:\n  " + "\n  ".join(findings) + "\n"
        "A module reported 'installed but broken' means the distribution is present but incomplete "
        "(commonly a missing llama-index-core under the llama_index namespace package) -- reinstalling "
        "the whole extra, not adding a package, is the fix: uv sync --extra llamaindex"
    )
