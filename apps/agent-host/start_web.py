#!/usr/bin/env python3
"""
Custom web server startup script for the agent runtime's
research assistant.

=============================================================================
WHY THIS FILE EXISTS - THE ASYNCIO/ANYIO EVENT LOOP CONFLICT
=============================================================================

The standard agent-runtime CLI command `nat serve` uses asyncio.run() internally to start
the FastAPI server. This creates a fundamental conflict with how anyio (used by
FastAPI/Starlette) manages event loops:

    Problem Chain:
    1. `nat serve` calls asyncio.run() which creates a NEW event loop
    2. FastAPI/Starlette uses anyio for async operations
    3. anyio detects there's already a running loop and refuses to create
       another
    4. Result: "RuntimeError: This event loop is already running" or
               "Runner.run() cannot be called from a running event loop"

    The Error You'd See:
    ```
    RuntimeError: asyncio.run() cannot be called from a running event loop
    ```
    or
    ```
    RuntimeError: Runner.run() cannot be called from a running event loop
    ```

=============================================================================
THE SOLUTION
=============================================================================

Instead of using `nat serve`, we bypass the asyncio.run() wrapper by:

1. Loading the agent runtime's configuration ourselves using the same loader the runtime uses
2. Setting up the required environment variables that the agent runtime's FastAPI app expects
3. Running uvicorn DIRECTLY with loop="asyncio"

This allows uvicorn to manage its own event loop without conflict.

Key insight: uvicorn's `loop="asyncio"` parameter tells it to create and manage
the event loop itself, rather than expecting one to already exist or creating
nested loops.

=============================================================================
ENVIRONMENT VARIABLES
=============================================================================

This script reads:
- CONFIG_FILE: Path to the agent-runtime config YAML (default:
  /app/configs/config_oib_openrouter.yml)
- HOST: Bind address (default: 0.0.0.0)
- PORT: Bind port (default: 8000)

This script sets (for the agent runtime's FastAPI app):
- NAT_CONFIG_FILE: Path to the config file (passed directly to the runtime)
- NAT_FRONT_END_WORKER: The worker class name for the FastAPI frontend

=============================================================================
ALTERNATIVE APPROACHES CONSIDERED
=============================================================================

1. nest_asyncio: Patches asyncio to allow nested event loops
   - Rejected: Can cause subtle bugs and is not recommended for production

2. Running nat serve in a subprocess
   - Rejected: Adds complexity, harder to manage signals/shutdown

3. Modifying the agent runtime's source code
   - Rejected: We want to use the agent runtime as a dependency, not fork it

4. Using uvicorn programmatically (THIS APPROACH)
   - Chosen: Clean, no patches, uvicorn handles the loop correctly

=============================================================================
USAGE
=============================================================================

This script is the main entry point for the Docker container:

    # In Dockerfile
    CMD ["python", "/app/apps/agent-host/start_web.py"]

Or run directly for local development:

    export CONFIG_FILE=/app/configs/config_oib_openrouter.yml
    python apps/agent-host/start_web.py

=============================================================================
"""

import logging
import os
import sys
import warnings

WS_IMPLEMENTATION = "websockets-sansio"

WS_PING_INTERVAL = 20.0
WS_PING_TIMEOUT = 60.0

if not os.environ.get("PYTHONWARNINGS"):
    warnings.filterwarnings("ignore")


def configure_logging():
    """Configure logging to match nat serve behavior."""
    log_level = os.environ.get("LOG_LEVEL", "INFO").upper()

    logging.basicConfig(
        level=getattr(logging, log_level, logging.INFO),
        format=("%(asctime)s - %(levelname)-8s - %(name)s:%(lineno)d - %(message)s"),
        datefmt="%Y-%m-%d %H:%M:%S",
        stream=sys.stdout,
        force=True,
    )

    logger_names = ("nat", "agent", "agent_host", "knowledge_layer")
    for logger_name in logger_names:
        logging.getLogger(logger_name).setLevel(getattr(logging, log_level, logging.INFO))

    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("openai").setLevel(logging.WARNING)

    return log_level


def load_nat_config(config_file: str):
    """Register Grid telemetry `_type`s, then load and validate the agent-runtime YAML.

    The JOIN `start_web` actually runs: a process that has imported none of
    pytest's plugins. `load_config` alone is not enough.
    """
    from agent.observability import ensure_registered as register_telemetry
    from agent.observability.boot_timing import BootClock
    from agent_host.roles import web_role
    from nat.runtime.loader import load_config

    register_telemetry()
    with BootClock(web_role().value).phase("load_config"):
        return load_config(config_file)


def main():
    """
    Main entry point for the web server.

    This function:
    1. Reads configuration from environment variables
    2. Loads and validates the agent-runtime config file
    3. Sets up environment variables required by the agent runtime's FastAPI app
    4. Starts uvicorn directly (bypassing nat serve's asyncio.run wrapper)
    """
    log_level = configure_logging()

    config_file = os.environ.get(
        "CONFIG_FILE",
        "/app/configs/config_oib_openrouter.yml",
    )
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8000"))

    print("=" * 60)
    print("NeMo Agent toolkit research assistant - Web Server")
    print("=" * 60)
    print(f"Config: {config_file}")
    print(f"Host: {host}:{port}")
    print(f"Log Level: {log_level}")
    print("Using custom startup script to avoid asyncio conflicts")
    print("=" * 60)
    print()

    print("Loading configuration...")
    config = load_nat_config(config_file)
    print("✓ Configuration loaded and validated")

    print("Setting NAT_CONFIG_FILE...")
    os.environ["NAT_CONFIG_FILE"] = config_file
    print(f"✓ NAT_CONFIG_FILE set to {config_file}")

    print("Setting up FastAPI worker...")
    from nat.front_ends.fastapi.utils import get_class_name

    try:
        runner_class_name = getattr(
            config.general.front_end,
            "runner_class",
            None,
        )
        if runner_class_name:
            os.environ["NAT_FRONT_END_WORKER"] = runner_class_name
            print(f"✓ Worker class (from config): {runner_class_name}")
        else:
            from nat.front_ends.fastapi.fastapi_front_end_plugin import FastApiFrontEndPlugin

            worker_class = FastApiFrontEndPlugin.get_worker_class(None)
            os.environ["NAT_FRONT_END_WORKER"] = get_class_name(worker_class)
            print(f"✓ Worker class (default): {os.environ['NAT_FRONT_END_WORKER']}")
    except AttributeError as e:
        print(f"⚠ Could not read runner_class from config: {e}")
        print("  Using default NAT worker")
        from nat.front_ends.fastapi.fastapi_front_end_plugin import FastApiFrontEndPlugin

        worker_class = FastApiFrontEndPlugin.get_worker_class(None)
        os.environ["NAT_FRONT_END_WORKER"] = get_class_name(worker_class)
        print(f"✓ Worker class (default): {os.environ['NAT_FRONT_END_WORKER']}")

    print()
    print("Starting uvicorn server...")
    print(f"Server will be available at: http://{host}:{port}")
    print(f"API Documentation: http://{host}:{port}/docs")
    print(f"Health Check: http://{host}:{port}/health")
    print()

    import uvicorn

    uvicorn.run(
        "nat.front_ends.fastapi.main:get_app",
        host=host,
        port=port,
        factory=True,
        loop="asyncio",
        ws=WS_IMPLEMENTATION,
        ws_ping_interval=WS_PING_INTERVAL,
        ws_ping_timeout=WS_PING_TIMEOUT,
    )


if __name__ == "__main__":
    main()
