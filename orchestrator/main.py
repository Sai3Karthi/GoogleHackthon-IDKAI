"""Run the orchestrator FastAPI service."""
import os

from .app import app, MODULES, config  # noqa: F401
import uvicorn


def run() -> None:
    """Start the orchestrator service using Uvicorn."""
    port_env = os.getenv("PORT")
    if port_env:
        orch_port = int(port_env)
        orch_host = "0.0.0.0"
    else:
        orch_port = config.get_orchestrator_port()
        orch_host = "0.0.0.0"

    print("=" * 70)
    print("IDK-AI Orchestrator (API Gateway)")
    print("=" * 70)
    print(f"Orchestrator running on: http://{orch_host}:{orch_port}")
    print("\nRegistered modules:")
    for name, mod_config in MODULES.items():
        print(f"  - {name}: {mod_config['host']}:{mod_config['port']} - {mod_config['description']}")
    print("\n  Start each module manually before use!")
    print("=" * 70)

    uvicorn.run(
        app,
        host=orch_host,
        port=orch_port,
        log_level="info",
    )


if __name__ == "__main__":
    run()
