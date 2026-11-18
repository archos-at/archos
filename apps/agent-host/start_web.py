#!/usr/bin/env python3

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
    from agent.observability import ensure_registered as register_telemetry
    from agent.observability.boot_timing import BootClock
    from agent_host.roles import web_role
    from nat.runtime.loader import load_config

    register_telemetry()
    with BootClock(web_role().value).phase("load_config"):
        return load_config(config_file)


def main():
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
