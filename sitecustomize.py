"""Site-wide runtime customizations for IDK-AI services."""

from __future__ import annotations

import asyncio
import sys

# Enforce Selector event loop on Windows so psycopg async connections stay compatible.
if sys.platform.startswith("win"):
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    except Exception:  # pragma: no cover - defensive guard
        pass
